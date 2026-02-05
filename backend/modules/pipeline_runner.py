#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""
Pipeline runner used by the API and dashboards to orchestrate the 7 modules.
It mirrors backend/main.py but adds progress tracking and persistence.
"""

import json
import logging
import os
from datetime import datetime
from pathlib import Path
from typing import Callable, Dict, List, Optional, Any
from concurrent.futures import ThreadPoolExecutor

from backend.modules.data_integrator import DataIntegrator
from backend.modules.forecast_evaluator import ForecastEvaluator
from backend.modules.icon_classifier import IconClassifier
from backend.modules.language_interpreter import LanguageInterpreter
from backend.modules.pdf_extractor import PDFExtractor
from backend.modules.pdf_scrap import MeteoBurkinaScraper
from backend.modules.temperature_extractor import TemperatureExtractor
from backend.modules.workflow_temperature_extractor import WorkflowTemperatureExtractor
from backend.utils.config import Config
from backend.utils.database import DatabaseManager

logger = logging.getLogger("anam.pipeline")


def _normalize_path(path_value: Optional[str]) -> Optional[str]:
    if not path_value:
        return None
    try:
        resolved = Path(path_value).resolve()
    except Exception:
        resolved = Path(path_value)
    return str(resolved).lower()


def _load_existing_interpretations(output_directory: Path) -> List[Dict]:
    result_file = output_directory / "resultats_interpretes.json"
    if not result_file.exists():
        return []
    try:
        with result_file.open("r", encoding="utf-8") as handle:
            data = json.load(handle)
            if isinstance(data, dict):
                data = [data]
            return data if isinstance(data, list) else []
    except Exception:
        return []


def _list_pending_pdfs(pdf_directory: Path, processed_paths: set[str]) -> List[Path]:
    all_pdfs = sorted(pdf_directory.glob("*.pdf"))
    if not processed_paths:
        return all_pdfs
    pending = []
    for pdf in all_pdfs:
        normalized = _normalize_path(str(pdf))
        if normalized not in processed_paths:
            pending.append(pdf)
    return pending


def _merge_interpretations(existing: List[Dict], new_entries: List[Dict]) -> List[Dict]:
    merged = list(existing)
    index = {}
    for idx, entry in enumerate(merged):
        normalized = _normalize_path(entry.get("pdf_path"))
        if normalized:
            index[normalized] = idx
    for entry in new_entries:
        normalized = _normalize_path(entry.get("pdf_path"))
        if not normalized:
            merged.append(entry)
            continue
        if normalized in index:
            merged[index[normalized]] = entry
        else:
            index[normalized] = len(merged)
            merged.append(entry)
    return merged


def _process_selected_pdfs(pdf_extractor: PDFExtractor, pdf_paths: List[Path]):
    workers = int(os.getenv("PDF_PROCESS_WORKERS", "2"))
    if workers <= 1 or len(pdf_paths) <= 1:
        results = []
        for pdf_path in pdf_paths:
            try:
                processed = pdf_extractor.process_single_pdf(pdf_path)
                if processed:
                    results.append(processed)
            except Exception:
                continue
        return results

    def _process(pdf_path):
        try:
            return pdf_extractor.process_single_pdf(pdf_path)
        except Exception:
            return None

    with ThreadPoolExecutor(max_workers=min(workers, len(pdf_paths))) as executor:
        processed = list(executor.map(_process, pdf_paths))
    return [item for item in processed if item]


class PipelineRunner:
    """Wraps the sequential execution of the 7 modules with persistence."""

    STEP_DEFINITIONS = [
        ("scraping", "Téléchargement des bulletins"),
        ("ocr", "Extraction OCR des cartes"),
        ("classification", "Classification des icônes météo"),
        ("integration", "Intégration des données"),
        ("evaluation", "Évaluation des prévisions"),
        ("interpretation", "Génération multilingue"),
    ]

    def __init__(
        self,
        config: Config,
        db_manager: DatabaseManager,
        run_id: int,
        options: Optional[Dict] = None,
        initial_steps: Optional[List[Dict]] = None,
        logger: Optional[Callable[[str], None]] = None,
    ):
        self.config = config
        self.db_manager = db_manager
        self.run_id = run_id
        self.options = options or {}
        base_steps = initial_steps or self.build_steps_template()
        self.steps = [dict(step) for step in base_steps]
        self.logger = logger or (lambda message: None)
        self.metadata: Dict = dict(self.options.get("metadata", {}))
        self.metadata.setdefault("notes", [])
        self.start_time = datetime.utcnow()
        self.current_step = None

    @classmethod
    def build_steps_template(cls):
        return [{"key": key, "label": label, "status": "pending"} for key, label in cls.STEP_DEFINITIONS]

    def run(self):
        self._log_event("pipeline_start")
        existing_interpretations = _load_existing_interpretations(self.config.output_directory)
        processed_paths = {
            normalized
            for normalized in (_normalize_path(entry.get("pdf_path")) for entry in existing_interpretations)
            if normalized
        }
        for db_path in self.db_manager.list_processed_pdf_paths():
            normalized = _normalize_path(db_path)
            if normalized:
                processed_paths.add(normalized)
        data_integrator = DataIntegrator(self.db_manager)
        evaluator = ForecastEvaluator(self.db_manager)
        self._persist_state(status="running")
        try:
            # Step 1: Scraping
            if self._should_skip("scraping"):
                self._mark_step_skipped("scraping", "Saut? par l'utilisateur.")
                pending_pdfs = _list_pending_pdfs(self.config.pdf_directory, processed_paths)
            else:
                pending_pdfs = self._execute_scraping(processed_paths)
            
            if self._is_cancelled():
                self._finish_cancelled()
                return

            if not pending_pdfs and not self._should_skip("scraping"):
                self.metadata["bulletins_processed"] = 0
                self._skip_remaining_steps("Aucun nouveau bulletin à traiter.")
                self._finish_success()
                return

            # Step 2: OCR
            if self._should_skip("ocr"):
                self._mark_step_skipped("ocr", "Saut? par l'utilisateur.")
                pdf_results, temperature_data = [], []
            else:
                pdf_results, temperature_data = self._execute_ocr(pending_pdfs)
                self._persist_intermediate_payloads(
                    data_integrator,
                    temperature_data,
                    icon_data=None,
                    stage="ocr",
                )
                self._persist_artifact_file("ocr.json", temperature_data)
            
            if self._is_cancelled():
                self._finish_cancelled()
                return

            # Step 3: Classification
            if self._should_skip("classification"):
                self._mark_step_skipped("classification", "Saut? par l'utilisateur.")
                icon_data = []
            else:
                icon_data = self._execute_classification(pdf_results)
                self._persist_intermediate_payloads(
                    data_integrator,
                    temperature_data,
                    icon_data=icon_data,
                    stage="classification",
                )
                self._persist_artifact_file("icons.json", icon_data)
            
            if self._is_cancelled():
                self._finish_cancelled()
                return

            # Step 4: Integration
            if self._should_skip("integration"):
                self._mark_step_skipped("integration", "Saut? par l'utilisateur.")
                integrated_data = []
            else:
                integrated_data = self._execute_integration(data_integrator, temperature_data, icon_data)
            
            if self._is_cancelled():
                self._finish_cancelled()
                return

            # Step 5: Evaluation
            if self._should_skip("evaluation"):
                self._mark_step_skipped("evaluation", "Saut? par l'utilisateur.")
                evaluation_metrics = None
            else:
                evaluation_metrics = self._execute_evaluation(evaluator)
            
            if self._is_cancelled():
                self._finish_cancelled()
                return

            # Step 6: Interpretation
            if self._should_skip("interpretation"):
                self._mark_step_skipped("interpretation", "Saut? par l'utilisateur.")
                interpreted_data = []
            else:
                interpreted_data = self._execute_interpretation(
                    data_integrator, integrated_data, existing_interpretations
                )

            if evaluation_metrics:
                self.metadata["evaluation"] = evaluation_metrics
            self.metadata["bulletins_processed"] = len(integrated_data)
            self.metadata["interpreted_bulletins"] = len(interpreted_data)
            self.metadata["total_duration"] = self._elapsed_seconds()
            self._finish_success()
            self._log_event(
                "pipeline_success",
                duration_seconds=self._elapsed_seconds(),
                metadata=self.metadata,
            )
        except Exception as exc:
            if self._is_cancelled():
                self._finish_cancelled()
            else:
                self.metadata["total_duration"] = self._elapsed_seconds()
                self._finish_failure(str(exc))
                self._log_event(
                    "pipeline_failure",
                    error=str(exc),
                    duration_seconds=self._elapsed_seconds(),
                    metadata=self.metadata,
                )

    def _execute_scraping(self, processed_paths: set[str]) -> List[Path]:
        self.current_step = "scraping"
        if not self.options.get("use_scraping", True):
            self._mark_step_skipped("scraping", "Scraping désactivé par l'utilisateur.")
        else:
            self._mark_step_running("scraping", "Téléchargement des bulletins en cours.")
            scraper = MeteoBurkinaScraper(output_dir=str(self.config.pdf_directory))
            try:
                summary = scraper.scrape_all(
                    self.options.get("use_pagination", True),
                    self.options.get("year"),
                    self.options.get("month"),
                    self.options.get("day"),
                    self.options.get("max_pages"),
                    self.options.get("max_bulletins"),
                    self.options.get("delay", 1.0),
                )
                self.metadata["scraped_bulletins"] = summary.get("success", 0)
                self._mark_step_success(
                    "scraping",
                    message=f"{summary.get('success', 0)} bulletins téléchargés.",
                    meta={"summary": summary},
                )
            except Exception as exc:
                self._mark_step_skipped("scraping", f"Scraping indisponible: {exc}")
                self._append_note(f"Scraping sauté: {exc}")
        pending = _list_pending_pdfs(self.config.pdf_directory, processed_paths)
        if pending:
            pending, skipped = self._filter_existing_pdf_paths(pending)
            if skipped:
                self._append_note(f"{len(skipped)} bulletins deja en base ignores.")
        self.metadata["pending_pdfs"] = len(pending)
        return pending

    def _execute_ocr(self, pending_pdfs: List[Path]):
        self.current_step = "ocr"
        self._mark_step_running("ocr", "Conversion des PDF et extraction OCR (Locale).")
        pdf_extractor = PDFExtractor(
            self.config.pdf_directory,
            self.config.output_directory
        )
        pdf_files = _process_selected_pdfs(pdf_extractor, pending_pdfs)
        if not pdf_files:
            mock_pdf = {
                "pdf_path": self.config.pdf_directory / "mock.pdf",
                "image_path": "",
                "maps": [],
            }
            pdf_files = [mock_pdf]
            self._append_note("OCR effectué en mode dégradé (mock).")
        else:
            pdf_files, skipped = self._filter_existing_pdf_results(pdf_files)
            if skipped:
                self._append_note(f"{len(skipped)} bulletins deja en base ignores (OCR).")
        if not pdf_files:
            self._mark_step_skipped("ocr", "Aucun bulletin a traiter (deja en base).")
            return [], []
        
        # Utilisation de l'extracteur local (ROI) uniquement
        temp_extractor = WorkflowTemperatureExtractor(roi_config_path=self.config.roi_config_path)
        try:
            temperature_data = temp_extractor.extract_temperatures_from_workflow(pdf_files)
        except Exception as exc:
            self._mark_step_failed("ocr", f"Extraction des températures impossible: {exc}")
            raise
        self._mark_step_success(
            "ocr",
            meta={"pdf_count": len(pdf_files), "detections": sum(len(entry.get("data", [])) for entry in temperature_data)},
        )
        return pdf_files, temperature_data

    def _execute_classification(self, pdf_files):
        self.current_step = "classification"
        self._mark_step_running("classification", "Classification des icônes météo (Locale).")
        if not pdf_files:
            self._mark_step_skipped("classification", "Aucun bulletin a traiter (deja en base).")
            return []
        icon_classifier = IconClassifier(
            roi_config_path=self.config.roi_config_path,
        )
        # Force local classification only
        try:
            icon_data = icon_classifier.classify_icons(pdf_files)
        except Exception as exc:
            self._mark_step_failed("classification", f"Classification impossible: {exc}")
            raise
        self._mark_step_success("classification", meta={"maps": len(icon_data)})
        return icon_data

    def _execute_integration(self, data_integrator: DataIntegrator, temperature_data, icon_data):
        self.current_step = "integration"
        self._mark_step_running("integration", "Intégration des données extraites.")
        if not temperature_data:
            self._mark_step_skipped("integration", "Aucune donnee a integrer (deja en base).")
            return []
        try:
            integrated_data = data_integrator.integrate_data(temperature_data, icon_data)
        except Exception as exc:
            self._mark_step_failed("integration", f"Intégration impossible: {exc}")
            raise
        self._mark_step_success("integration", meta={"bulletins": len(integrated_data)})
        return integrated_data

    def _execute_evaluation(self, evaluator: ForecastEvaluator):
        self.current_step = "evaluation"
        self._mark_step_running("evaluation", "Calcul des métriques.")
        try:
            metrics = evaluator.evaluate_forecasts()
            self._mark_step_success("evaluation", meta=metrics or {})
            return metrics
        except Exception as exc:
            self._mark_step_skipped("evaluation", f"Évaluation indisponible: {exc}")
            self._append_note(f"Évaluation sautée: {exc}")
            return {}

    def _execute_interpretation(self, data_integrator: DataIntegrator, integrated_data, existing_interpretations):
        self.current_step = "interpretation"
        self._mark_step_running("interpretation", "Génération des bulletins multilingues.")
        if not integrated_data:
            self._mark_step_skipped("interpretation", "Aucune donnee a interpreter (deja en base).")
            return []
        interpreter = LanguageInterpreter.get_shared(db_manager=self.db_manager)
        try:
            interpreted_data = interpreter.generate_interpretations(integrated_data)
        except Exception as exc:
            self._mark_step_skipped("interpretation", f"Interprétation indisponible: {exc}")
            self._append_note(f"Interprétation sautée: {exc}")
            interpreted_data = []
        merged = _merge_interpretations(existing_interpretations, interpreted_data)
        try:
            data_integrator.save_final_dataset(merged, self.config.output_directory)
        except Exception as exc:
            self._append_note(f"Sauvegarde finale impossible: {exc}")
        if interpreted_data:
            self._mark_step_success("interpretation", meta={"entries": len(interpreted_data)})
        return interpreted_data

    def _mark_step_running(self, key, message=None):
        step = self._get_step(key)
        timestamp = self._now()
        step.setdefault("started_at", timestamp)
        step["status"] = "running"
        if message:
            step["message"] = message
        self._log_event("step_running", step=key, message=message)
        self._persist_state()

    def _mark_step_success(self, key, message=None, meta=None):
        step = self._get_step(key)
        if not step.get("started_at"):
            step["started_at"] = self._now()
        step["finished_at"] = self._now()
        step["status"] = "success"
        if message:
            step["message"] = message
        if meta is not None:
            step["meta"] = meta
        self._log_event("step_success", step=key, message=message, meta=meta)
        self._persist_state()

    def _mark_step_failed(self, key, message):
        step = self._get_step(key)
        if not step.get("started_at"):
            step["started_at"] = self._now()
        step["finished_at"] = self._now()
        step["status"] = "error"
        step["message"] = message
        self._log_event("step_failed", step=key, message=message)
        self._persist_state()

    def _mark_step_skipped(self, key, message):
        step = self._get_step(key)
        step["status"] = "skipped"
        step["message"] = message
        step.setdefault("started_at", self._now())
        step["finished_at"] = self._now()
        self._log_event("step_skipped", step=key, message=message)
        self._persist_state()

    def _skip_remaining_steps(self, reason):
        for step in self.steps:
            if step.get("status") in {"pending", "running"}:
                self._mark_step_skipped(step.get("key"), reason)

    def _persist_state(self, status=None, error=None, finished=False):
        self.db_manager.update_pipeline_run(
            self.run_id,
            status=status,
            steps=self.steps,
            error_message=error,
            metadata=self.metadata,
            finished=finished,
        )

    def _persist_artifact_file(self, filename: str, payload: Any) -> None:
        """Save intermediate artifacts to disk for debugging/replay."""
        try:
            run_dir = self.config.output_directory / "pipeline_runs" / str(self.run_id)
            run_dir.mkdir(parents=True, exist_ok=True)
            path = run_dir / filename
            with open(path, "w", encoding="utf-8") as handle:
                json.dump(payload, handle, ensure_ascii=False, indent=2)
            self.metadata.setdefault("artifacts", [])
            if str(path) not in self.metadata["artifacts"]:
                self.metadata["artifacts"].append(str(path))
            self._persist_state()
        except Exception as exc:
            self._append_note(f"Artifact save failed ({filename}): {exc}")

    def _persist_intermediate_payloads(
        self,
        data_integrator: DataIntegrator,
        temperature_data: List[Dict],
        icon_data: Optional[List[Dict]] = None,
        stage: str = "ocr",
    ) -> None:
        """Persist intermediate extraction results after each module."""
        if not temperature_data:
            return

        icon_index = {}
        for entry in icon_data or []:
            key = _normalize_path(entry.get("pdf_path"))
            if key:
                icon_index[key] = entry

        saved_payloads = 0
        saved_snapshots = 0
        for temp_pdf_data in temperature_data:
            pdf_path = temp_pdf_data.get("pdf_path")
            if not pdf_path:
                continue
            key = _normalize_path(str(pdf_path))
            icon_pdf_data = icon_index.get(key, {"pdf_path": pdf_path, "data": []})

            aligned_maps = self._align_intermediate_maps(
                temp_pdf_data.get("data", []),
                icon_pdf_data.get("data", []),
            )

            stations: List[Dict] = []
            for map_type, temps, icons in aligned_maps:
                combined = data_integrator.combine_page_data(temps, icons)
                for station in combined:
                    station_payload = {
                        "name": station.get("name"),
                        "bbox": station.get("bbox"),
                        "tmin": station.get("tmin"),
                        "tmax": station.get("tmax"),
                        "tmin_raw": station.get("tmin_raw"),
                        "tmax_raw": station.get("tmax_raw"),
                        "weather_condition": station.get("weather_condition"),
                        "confidence": station.get("confidence"),
                        "type": map_type,
                        "extraction_stage": stage,
                    }
                    stations.append(station_payload)

            payload = {
                "pdf_path": str(pdf_path),
                "stations": stations,
                "stage": stage,
                "generated_at": self._now(),
            }

            try:
                self.db_manager.upsert_bulletin_payload(str(pdf_path), payload)
                saved_payloads += 1
            except Exception as exc:
                self._append_note(f"Intermediate payload persist failed for {pdf_path}: {exc}")

            for station in stations:
                try:
                    self.db_manager.upsert_station_snapshot(str(pdf_path), station)
                    saved_snapshots += 1
                except Exception as exc:
                    name = station.get("name") or "station_sans_nom"
                    self._append_note(f"Snapshot persist failed for {name}: {exc}")

        self.metadata[f"{stage}_payloads_saved"] = saved_payloads
        self.metadata[f"{stage}_snapshots_saved"] = saved_snapshots
        self._persist_state()

    @staticmethod
    def _align_intermediate_maps(temp_maps: List[Dict], icon_maps: List[Dict]):
        """Align observation/forecast maps for intermediate persistence."""
        if not temp_maps and not icon_maps:
            return []

        icons_by_type: Dict[str, List[Dict]] = {}
        for entry in icon_maps or []:
            icons_by_type.setdefault(entry.get("type") or "observation", []).extend(
                entry.get("icons", [])
            )

        aligned = []
        for temp_entry in temp_maps or []:
            map_type = temp_entry.get("type", "observation")
            if map_type not in {"observation", "forecast"}:
                map_type = "observation"
            temps = temp_entry.get("temperatures", [])
            aligned.append((map_type, temps, icons_by_type.get(map_type, [])))

        mapped_types = set()
        for entry in temp_maps or []:
            entry_type = entry.get("type", "observation")
            if entry_type not in {"observation", "forecast"}:
                entry_type = "observation"
            mapped_types.add(entry_type)

        for icon_entry in icon_maps or []:
            map_type = icon_entry.get("type", "observation")
            if map_type not in {"observation", "forecast"}:
                map_type = "observation"
            if map_type not in mapped_types:
                aligned.append((map_type, [], icon_entry.get("icons", [])))

        return aligned

    def _finish_success(self):
        self._persist_state(status="success", finished=True)
        self._cleanup_temp_files()

    def _finish_failure(self, message):
        self._persist_state(status="error", error=message, finished=True)
        self._cleanup_temp_files()

    def _finish_cancelled(self):
        self._persist_state(status="cancelled", finished=True)
        self._cleanup_temp_files()
        self._log_event("pipeline_cancelled")

    def _should_skip(self, step_key):
        """Check if a step should be skipped based on database status."""
        run = self.db_manager.get_pipeline_run(self.run_id)
        if not run:
            return False
        for s in run.get("steps", []):
            if s.get("key") == step_key and s.get("status") == "skipped":
                return True
        return False

    def _is_cancelled(self):
        """Check if the run has been cancelled in the database."""
        run = self.db_manager.get_pipeline_run(self.run_id)
        return run and run.get("status") == "cancelled"

    def _cleanup_temp_files(self) -> None:
        retention_days = int(os.getenv("TEMP_FILE_RETENTION_DAYS", "7"))
        if self.db_manager is not None:
            try:
                stored = self.db_manager.get_app_state("temp_file_retention_days")
                if stored:
                    retention_days = int(stored)
            except Exception:
                pass
        if retention_days <= 0:
            return

        cutoff = datetime.now().timestamp() - (retention_days * 86400)
        temp_dirs = [
            self.config.temp_directory,
            self.config.output_directory / "temp",
        ]
        removed = 0
        errors = 0

        for temp_dir in temp_dirs:
            if not temp_dir or not Path(temp_dir).exists():
                continue
            for root, _, files in os.walk(temp_dir):
                for filename in files:
                    path = Path(root) / filename
                    try:
                        if path.stat().st_mtime < cutoff:
                            path.unlink()
                            removed += 1
                    except Exception:
                        errors += 1
            for root, dirs, files in os.walk(temp_dir, topdown=False):
                if not dirs and not files:
                    try:
                        Path(root).rmdir()
                    except Exception:
                        errors += 1

        if removed or errors:
            logger.info(
                "Temp cleanup: removed=%s errors=%s retention_days=%s",
                removed,
                errors,
                retention_days,
            )

    def _get_step(self, key):
        for step in self.steps:
            if step.get("key") == key:
                return step
        new_step = {"key": key, "label": key, "status": "pending"}
        self.steps.append(new_step)
        return new_step

    def _append_note(self, note: str):
        self.metadata.setdefault("notes", [])
        self.metadata["notes"].append(note)
        self._log_event("pipeline_note", note=note)

    def _log_event(self, event: str, **fields):
        payload = {
            "event": event,
            "run_id": self.run_id,
            "ts": datetime.utcnow().isoformat(),
        }
        payload.update({key: value for key, value in fields.items() if value is not None})
        logger.info(json.dumps(payload, ensure_ascii=True))

    def _filter_existing_pdf_paths(self, pdf_paths: List[Path]):
        processed = {
            _normalize_path(path_value)
            for path_value in self.db_manager.list_processed_pdf_paths()
        }
        if not processed:
            return pdf_paths, []
        remaining = []
        skipped = []
        for pdf in pdf_paths:
            normalized = _normalize_path(str(pdf))
            if normalized in processed:
                skipped.append(pdf)
            else:
                remaining.append(pdf)
        return remaining, skipped

    def _filter_existing_pdf_results(self, pdf_results: List[Dict]):
        processed = {
            _normalize_path(path_value)
            for path_value in self.db_manager.list_processed_pdf_paths()
        }
        if not processed:
            return pdf_results, []
        remaining = []
        skipped = []
        for pdf in pdf_results:
            pdf_path = pdf.get("pdf_path")
            normalized = _normalize_path(str(pdf_path)) if pdf_path else None
            if normalized and normalized in processed:
                skipped.append(pdf)
            else:
                remaining.append(pdf)
        return remaining, skipped

    def _elapsed_seconds(self):
        return int((datetime.utcnow() - self.start_time).total_seconds())

    @staticmethod
    def _now():
        return datetime.utcnow().isoformat()
