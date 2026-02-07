import logging
import uuid
from datetime import datetime, timedelta
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, BackgroundTasks, HTTPException, Query
from fastapi.concurrency import run_in_threadpool

from backend.api_v1.models import BulletinData, BulletinsPage, TranslationRegenerateRequest
import backend.api_v1.core as core
from backend.api_v1.core import _ensure_db_ready, ErrorCode
from backend.api_v1.utils import _cache_get, _cache_set, _cache_clear, _load_result_file
from backend.utils.background_tasks import get_task_manager, TaskStatus
from backend.modules.data_integrator import DataIntegrator
from backend.modules.icon_classifier import IconClassifier
from backend.modules.pdf_extractor import PDFExtractor
from backend.modules.pdf_scrap import MeteoBurkinaScraper, ScrapeConfig
from backend.modules.workflow_temperature_extractor import WorkflowTemperatureExtractor

logger = logging.getLogger("anam.api")
router = APIRouter(tags=["bulletins"])


def _infer_bulletin_type_from_filename(filename: str) -> Optional[str]:
    lowered = filename.lower()
    if "forecast" in lowered or "prevision" in lowered or "prÃ©vision" in lowered:
        return "forecast"
    if "observed" in lowered or "observation" in lowered or "obs" in lowered:
        return "observation"
    return None


def _resolve_pdf_path(file_path: str, pdf_directory: Path, project_root: Path) -> Optional[Path]:
    if not file_path:
        return None
    candidate = Path(file_path)
    if not candidate.is_absolute():
        repo_root = project_root.parent
        repo_candidate = repo_root / candidate
        project_candidate = project_root / candidate
        if repo_candidate.exists():
            candidate = repo_candidate
        elif project_candidate.exists():
            candidate = project_candidate
    if candidate.exists():
        return candidate
    name = Path(file_path).name
    if name:
        direct = pdf_directory / name
        if direct.exists():
            return direct
        for pdf in pdf_directory.glob("*.pdf"):
            if pdf.name.lower() == name.lower():
                return pdf
    return None


def _build_target_pdf_path(file_path: str, pdf_directory: Path, project_root: Path) -> Optional[Path]:
    if not file_path:
        return None
    candidate = Path(file_path)
    if candidate.is_absolute():
        return candidate
    repo_root = project_root.parent
    raw = str(candidate).replace("\\", "/").lower()
    if raw.startswith("backend/"):
        return repo_root / candidate
    return project_root / candidate


def _try_redownload_pdf(
    file_path: str,
    bulletin_date: Optional[str],
    pdf_directory: Path,
    project_root: Path,
) -> Optional[Path]:
    if not bulletin_date:
        return None
    try:
        parsed_date = datetime.strptime(bulletin_date, "%Y-%m-%d")
    except ValueError:
        return None

    target_path = _build_target_pdf_path(file_path, pdf_directory, project_root)
    if not target_path:
        return None
    target_path.parent.mkdir(parents=True, exist_ok=True)

    scraper = MeteoBurkinaScraper(
        output_dir=str(target_path.parent),
        config=ScrapeConfig(),
    )
    bulletins = scraper.get_bulletin_list(
        use_pagination=True,
        max_pages=2,
        year=parsed_date.year,
        month=parsed_date.month,
        day=parsed_date.day,
    )
    if not bulletins:
        return None

    for bulletin in bulletins:
        pdf_url = scraper.extract_pdf_link(bulletin.get("url"))
        if not pdf_url:
            continue
        result = scraper.download_pdf(pdf_url, target_path.name, title=bulletin.get("title"))
        status = result.get("status")
        if status in {"success", "skipped"} and result.get("path"):
            downloaded = Path(result["path"])
            if downloaded.exists():
                return downloaded

    return None


def _fill_missing_values(target: dict, source: dict, keys: list[str]) -> None:
    for key in keys:
        if target.get(key) is None and source.get(key) is not None:
            target[key] = source[key]


def _reprocess_pdf_entry(
    file_path: str,
    pdf_path: Path,
    db_manager,
    data_integrator: DataIntegrator,
    pdf_extractor: PDFExtractor,
    temp_extractor: WorkflowTemperatureExtractor,
    icon_classifier: IconClassifier,
) -> Optional[str]:
    pdf_result = pdf_extractor.process_single_pdf(pdf_path)
    if not pdf_result:
        return "Aucune carte detectee."

    temperature_data = temp_extractor.extract_temperatures_from_workflow([pdf_result])
    if not temperature_data:
        return "Aucune extraction temperature disponible."

    icon_data = icon_classifier.classify_icons([pdf_result])

    existing_payload = db_manager.get_bulletin_payload_by_path(file_path) or {}
    existing_station_map = {
        station.get("name"): station
        for station in (existing_payload.get("stations") or [])
        if station.get("name")
    }

    bulletins = db_manager.list_bulletins_by_file_path(file_path)
    bulletins_by_type = {entry.get("type"): entry for entry in bulletins if entry.get("type")}

    date_for_payload = (
        existing_payload.get("date")
        or (bulletins[0].get("date") if bulletins else None)
        or data_integrator._extract_bulletin_date(pdf_path)
        or datetime.today().strftime("%Y-%m-%d")
    )
    payload_type = (
        existing_payload.get("type")
        or _infer_bulletin_type_from_filename(file_path)
        or "observation"
    )

    station_records: dict[str, dict] = {}
    icon_index = data_integrator._index_icon_data(icon_data)

    for temp_pdf_data in temperature_data:
        pdf_key = data_integrator._normalize_pdf_key(temp_pdf_data.get("pdf_path"))
        icon_pdf_data = icon_index.get(
            pdf_key,
            {"pdf_path": temp_pdf_data.get("pdf_path"), "data": []},
        )
        aligned_maps = data_integrator._align_map_pages(
            temp_pdf_data.get("data", []),
            icon_pdf_data.get("data", []),
        )

        for map_type, temps, icons in aligned_maps:
            normalized_type = map_type if map_type in {"observation", "forecast"} else "observation"
            stations_data = data_integrator.combine_page_data(temps, icons)
            if not stations_data:
                continue

            bulletin_record = bulletins_by_type.get(normalized_type)
            bulletin_date = (bulletin_record or {}).get("date") or date_for_payload
            if bulletin_record:
                bulletin_id = bulletin_record.get("id")
            else:
                bulletin_id = db_manager.insert_bulletin(
                    bulletin_date,
                    normalized_type,
                    file_path,
                    Path(file_path).stem,
                )
                bulletin_record = {
                    "id": bulletin_id,
                    "date": bulletin_date,
                    "type": normalized_type,
                    "file_path": file_path,
                }
                bulletins_by_type[normalized_type] = bulletin_record

            for station in stations_data:
                station_name = data_integrator._resolve_station_name(station.get("name"))
                if not station_name:
                    continue
                coords = data_integrator.stations_map.get(station_name, {"lat": None, "lon": None})
                station_id = db_manager.insert_station(
                    station_name,
                    coords.get("lat"),
                    coords.get("lon"),
                )

                measurement = {
                    "tmin": station.get("tmin"),
                    "tmax": station.get("tmax"),
                    "weather_condition": station.get("weather_condition"),
                    "confidence": station.get("confidence"),
                    "tmin_raw": station.get("tmin_raw"),
                    "tmax_raw": station.get("tmax_raw"),
                    "bbox": station.get("bbox"),
                }
                measurement = data_integrator._enforce_temperature_rules(measurement)
                measurement, warnings, _issues = data_integrator.validator.validate_measurement(
                    station_name,
                    measurement,
                    normalized_type,
                    bulletin_date,
                )

                if bulletin_id and station_id:
                    db_manager.upsert_weather_data(
                        bulletin_id=bulletin_id,
                        station_id=station_id,
                        tmin=measurement.get("tmin"),
                        tmax=measurement.get("tmax"),
                        weather_condition=measurement.get("weather_condition"),
                        tmin_raw=measurement.get("tmin_raw"),
                        tmax_raw=measurement.get("tmax_raw"),
                    )

                record = station_records.setdefault(
                    station_name,
                    data_integrator._build_station_record(station_name, coords),
                )
                target_slot = "prevision" if normalized_type == "forecast" else normalized_type
                record[target_slot] = data_integrator._merge_measurements(
                    record.get(target_slot, {}),
                    measurement,
                )
                record["last_bbox"] = measurement.get("bbox") or record.get("last_bbox")
                if warnings:
                    record["validation_errors"].extend(warnings)

    if not station_records:
        return "Aucune station extraite."

    stations_payload = []
    seen_names = set()
    for record in station_records.values():
        data_integrator._finalize_station_record(record)
        existing_station = existing_station_map.get(record.get("name"))
        if existing_station:
            for block_name in ("observation", "prevision"):
                block = record.get(block_name) or {}
                existing_block = existing_station.get(block_name) or {}
                _fill_missing_values(
                    block,
                    existing_block,
                    ["tmin", "tmax", "weather_condition", "confidence", "tmin_raw", "tmax_raw", "quality_score"],
                )
                record[block_name] = block
            if not record.get("validation_errors") and existing_station.get("validation_errors"):
                record["validation_errors"] = existing_station.get("validation_errors")
            _fill_missing_values(
                record,
                existing_station,
                [
                    "latitude",
                    "longitude",
                    "last_bbox",
                    "quality_score",
                    "confidence",
                    "tmin",
                    "tmax",
                    "weather_condition",
                    "tmin_raw",
                    "tmax_raw",
                    "type",
                ],
            )
            _fill_missing_values(
                record,
                existing_station,
                ["interpretation_francais", "interpretation_moore", "interpretation_dioula"],
            )
            data_integrator._finalize_station_record(record)
        stations_payload.append(record)
        seen_names.add(record.get("name"))
        db_manager.upsert_station_snapshot(file_path, record)

    if existing_payload.get("stations"):
        for station in existing_payload.get("stations", []):
            name = station.get("name")
            if not name or name in seen_names:
                continue
            stations_payload.append(station)

    payload = dict(existing_payload) if isinstance(existing_payload, dict) else {}
    payload.update(
        {
            "pdf_path": file_path,
            "date": date_for_payload,
            "type": payload_type,
            "stations": stations_payload,
        }
    )
    db_manager.upsert_bulletin_payload(file_path, payload)
    return None

@router.get("/bulletins", response_model=BulletinsPage)
async def list_bulletins(
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
):
    """Return paginated bulletin summaries."""
    _ensure_db_ready()
    assert core.db_manager is not None
    items = core.db_manager.list_bulletin_summaries(limit=limit, offset=offset)
    total = core.db_manager.count_bulletin_summaries()
    return {"items": items, "total": total, "limit": limit, "offset": offset}


@router.get("/bulletins/{date}", response_model=BulletinData)
async def get_bulletin_by_date(
    date: str, 
    bulletin_type: Optional[str] = Query(None, alias="type", enum=["observation", "forecast"])
):
    """Retourner toutes les stations pour une date de bulletin spécifique."""
    cache_key = f"bulletins:detail:{date}:{bulletin_type or 'all'}"
    cached = _cache_get(cache_key)
    if cached is not None:
        return cached
    
    def _station_to_payload(station):
        observation = station.get("observation", {}) or {}
        prevision = station.get("prevision", {}) or {}
        return {
            "name": station.get("name"),
            "latitude": station.get("latitude"),
            "longitude": station.get("longitude"),
            "tmin_obs": observation.get("tmin"),
            "tmax_obs": observation.get("tmax"),
            "weather_obs": observation.get("weather_condition"),
            "tmin_prev": prevision.get("tmin"),
            "tmax_prev": prevision.get("tmax"),
            "weather_prev": prevision.get("weather_condition"),
            "interpretation_francais": station.get("interpretation_francais"),
            "interpretation_moore": station.get("interpretation_moore"),
            "interpretation_dioula": station.get("interpretation_dioula"),
            "quality_score": station.get("quality_score"),
        }

    def _merge_station(existing, incoming):
        if existing is None:
            return incoming
        for key, value in incoming.items():
            if existing.get(key) is None and value is not None:
                existing[key] = value
        return existing

    stations_payload = []
    bulletin_interpretations = {"fr": None, "moore": None, "dioula": None}
    
    if core.db_manager is not None:
        payloads = core.db_manager.list_bulletin_payloads_by_date(date)
        
        try:
            dt_obj = datetime.strptime(date, "%Y-%m-%d")
            prev_date = (dt_obj - timedelta(days=1)).strftime("%Y-%m-%d")
            prev_payloads = core.db_manager.list_bulletin_payloads_by_date(prev_date)
            prev_forecasts = [p for p in prev_payloads if p.get("type") == "forecast" or "forecast" in str(p.get("pdf_path")).lower() or "prevision" in str(p.get("pdf_path")).lower()]
            payloads = prev_forecasts + payloads
        except Exception as e:
            logger.warning(f"Erreur lors de la récupération du bulletin J-1 pour {date}: {e}")

        if bulletin_type:
            payloads = [p for p in payloads if p.get("type") == bulletin_type or bulletin_type in str(p.get("pdf_path")).lower()]
    else:
        payloads = []
        
    if payloads:
        station_map = {}
        for entry in payloads:
            if not bulletin_interpretations["fr"]:
                bulletin_interpretations["fr"] = entry.get("interpretation_francais")
                bulletin_interpretations["moore"] = entry.get("interpretation_moore")
                bulletin_interpretations["dioula"] = entry.get("interpretation_dioula")
            
            for station in entry.get("stations", []):
                payload = _station_to_payload(station)
                key = payload.get("name") or f"station_{len(station_map) + 1}"
                station_map[key] = _merge_station(station_map.get(key), payload)
        stations_payload = list(station_map.values())
    else:
        bulletins = _load_result_file()
        for entry in bulletins:
            if entry.get("date") != date:
                continue
            if bulletin_type and entry.get("type") != bulletin_type:
                continue
            
            if not bulletin_interpretations["fr"]:
                bulletin_interpretations["fr"] = entry.get("interpretation_francais")
                bulletin_interpretations["moore"] = entry.get("interpretation_moore")
                bulletin_interpretations["dioula"] = entry.get("interpretation_dioula")
                
            for station in entry.get("stations", []):
                stations_payload.append(_station_to_payload(station))

    if not stations_payload:
        raise HTTPException(
            status_code=404,
            detail={
                "code": ErrorCode.BULLETIN_NOT_FOUND.value,
                "message": f"No bulletin for {date} ({bulletin_type or 'all'}).",
            },
        )

    payload = {
        "date_bulletin": date, 
        "type": bulletin_type or (payloads[0].get("type") if payloads else "observation"),
        "stations": stations_payload,
        "interpretation_francais": bulletin_interpretations["fr"],
        "interpretation_moore": bulletin_interpretations["moore"],
        "interpretation_dioula": bulletin_interpretations["dioula"],
    }
    _cache_set(cache_key, payload)
    return payload


@router.post("/bulletins/regenerate-translation")
async def regenerate_translation(payload: TranslationRegenerateRequest):
    """Régénérer une interprétation ou une traduction spécifique."""
    _ensure_db_ready()
    assert core.db_manager is not None
    
    station_payloads = core.db_manager.list_bulletin_payloads_by_date(payload.date)
    if not station_payloads:
        raise HTTPException(status_code=404, detail="Bulletin non trouvé pour cette date.")
        
    target_station = None
    target_pdf_path = None
    is_generic = payload.station_name.lower() in ["bulletin national", "national", "all", "tout", "toutes"]
    
    # ✨ PRIORITÉ AUX PRÉVISIONS : Chercher d'abord les bulletins de type "forecast"
    forecast_payloads = [p for p in station_payloads if p.get("type") == "forecast" or "forecast" in str(p.get("pdf_path", "")).lower() or "prevision" in str(p.get("pdf_path", "")).lower()]
    observation_payloads = [p for p in station_payloads if p not in forecast_payloads]
    
    # Parcourir d'abord les prévisions, puis les observations
    payloads_to_check = forecast_payloads + observation_payloads
    
    for entry in payloads_to_check:
        if is_generic and entry.get("stations"):
            target_station = entry["stations"][0]
            target_pdf_path = entry.get("pdf_path")
            break
        for station in entry.get("stations", []):
            if station.get("name") == payload.station_name:
                target_station = station
                target_pdf_path = entry.get("pdf_path")
                break
        if target_station:
            target_station["pdf_path"] = target_pdf_path
            target_station["date"] = payload.date
            break
            
    if not target_station:
        if is_generic and payloads_to_check:
             for entry in payloads_to_check:
                 if entry.get("stations"):
                     target_station = entry["stations"][0].copy()
                     target_pdf_path = entry.get("pdf_path")
                     target_station["pdf_path"] = target_pdf_path
                     target_station["date"] = payload.date
                     break
        
        if not target_station:
            raise HTTPException(status_code=404, detail="Station ou bulletin non trouvé pour cette date.")
        
    from backend.modules.language_interpreter import LanguageInterpreter
    interpreter = LanguageInterpreter.get_shared(core.db_manager)
    
    # ✨ Intégration de la nouvelle API de traduction en mooré
    async def translate_with_external_api(text: str, target_lang: str) -> str:
        """Utilise l'API externe pour la traduction en mooré"""
        if target_lang != "moore":
            # Pour les autres langues, utiliser l'interpréteur existant
            return interpreter.translate(text, target_lang, force=True)
        
        import aiohttp
        import asyncio
        
        url = "https://fr-mos-translator-314397473739.europe-west1.run.app/api/translate"
        payload = {
            "text": text,
            "source_lang": "french",
            "target_lang": "moore"
        }
        
        try:
            timeout = aiohttp.ClientTimeout(total=30)
            async with aiohttp.ClientSession(timeout=timeout) as session:
                async with session.post(url, json=payload) as response:
                    if response.status == 200:
                        result = await response.json()
                        return result.get("translation", "")
                    else:
                        logger.warning(f"API externe a retourné le statut {response.status}")
                        return ""
        except Exception as e:
            logger.error(f"Erreur lors de la traduction via API externe : {e}")
            return ""
    
    if payload.language in [None, "all", "interpretation_francais", "fr", "francais"]:
        french_text = interpreter._generate_french_bulletin(target_station)
        if french_text:
            target_station["interpretation_francais"] = french_text
            
    french_text = target_station.get("interpretation_francais")
    if not french_text:
        for entry in station_payloads:
            if entry.get("interpretation_francais"):
                french_text = entry.get("interpretation_francais")
                target_station["interpretation_francais"] = french_text
                break
    
    if not french_text:
        logger.info(f"Extraction automatique du texte FR pour le bulletin du {payload.date}")
        french_text = interpreter._generate_french_bulletin(target_station)
        if french_text:
            target_station["interpretation_francais"] = french_text

    if not french_text:
        raise HTTPException(status_code=400, detail="Impossible d'extraire le texte français du PDF. Vérifiez que le fichier existe.")
        
    langs_to_regen = []
    if payload.language in [None, "all"]:
        langs_to_regen = ["moore", "dioula"]
    elif payload.language in ["moore", "interpretation_moore"]:
        langs_to_regen = ["moore"]
    elif payload.language in ["dioula", "interpretation_dioula"]:
        langs_to_regen = ["dioula"]
        
    new_translations = {"fr": french_text}
    for lang in langs_to_regen:
        if lang == "moore":
            # Utiliser l'API externe pour le mooré
            translated = await translate_with_external_api(french_text, lang)
        else:
            # Utiliser l'interpréteur existant pour le dioula
            translated = interpreter.translate(french_text, lang, force=True)
            
        if translated:
            target_station[f"interpretation_{lang}"] = translated
            new_translations[lang] = translated
            
    raw_type = target_station.get("type") or ("forecast" if "forecast" in str(target_pdf_path).lower() or "prevision" in str(target_pdf_path).lower() else "observation")
    type_map = {
        "prevision": "forecast",
        "prévision": "forecast",
        "forecast": "forecast",
        "observation": "observation",
        "obs": "observation"
    }
    bulletin_type_detected = type_map.get(str(raw_type).lower(), "observation")
    
    logger.info(f"Mise à jour DB pour le bulletin {payload.date} (Type détecté: {raw_type} -> DB: {bulletin_type_detected})")
    rows_updated = core.db_manager.update_bulletin_interpretations(payload.date, bulletin_type_detected, new_translations)
    logger.info(f"Nombre de lignes mises à jour dans 'bulletins' : {rows_updated}")
    
    station_snapshot = target_station.copy()
    station_snapshot["interpretation_francais"] = None
    station_snapshot["interpretation_moore"] = None
    station_snapshot["interpretation_dioula"] = None
    
    core.db_manager.upsert_station_snapshot(target_pdf_path, station_snapshot)
    
    for entry in station_payloads:
        if entry.get("pdf_path") == target_pdf_path:
            for lang_key in ["fr", "moore", "dioula"]:
                if lang_key in new_translations:
                    field_name = "interpretation_francais" if lang_key == "fr" else f"interpretation_{lang_key}"
                    entry[field_name] = new_translations[lang_key]
            
            for i, st in enumerate(entry.get("stations", [])):
                if st.get("name") == target_station.get("name"):
                    entry["stations"][i] = station_snapshot
                    break
            
            core.db_manager.upsert_bulletin_payload(target_pdf_path, entry)
            logger.info(f"Payload JSON mis à jour pour {target_pdf_path}")
            break
            
    _cache_clear("bulletins:")
    
    return {
        "status": "success",
        "station": payload.station_name,
        "date": payload.date,
        "translations": {
            "fr": new_translations.get("fr"),
            "moore": new_translations.get("moore"),
            "dioula": new_translations.get("dioula"),
        }
    }


@router.post("/bulletins/regenerate-translation-async")
async def regenerate_translation_async(payload: TranslationRegenerateRequest):
    """
    Lance une régénération de traduction en arrière-plan (non-bloquant).
    
    ⚡ Optimisation : Vérifie d'abord si la traduction existe déjà dans la BD.
    Si elle existe, retourne immédiatement sans lancer de tâche.
    
    Retourne immédiatement un ID de tâche que le client peut utiliser
    pour suivre la progression via /bulletins/translation-task/{task_id}.
    
    Avantages :
    - L'API reste réactive pendant la traduction
    - Permet plusieurs traductions simultanées (jusqu'à max_workers)
    - Le client peut interroger le statut et récupérer le résultat
    - Évite les traductions inutiles si déjà présentes
    """
    _ensure_db_ready()
    assert core.db_manager is not None
    
    # Vérification rapide que le bulletin existe
    station_payloads = core.db_manager.list_bulletin_payloads_by_date(payload.date)
    if not station_payloads:
        raise HTTPException(status_code=404, detail="Bulletin non trouvé pour cette date.")
    
    # ✨ NOUVELLE FONCTIONNALITÉ : Vérifier si les traductions existent déjà dans la BD
    existing_bulletins = core.db_manager.list_bulletin_summaries(limit=500)
    target_bulletin = None
    for bulletin in existing_bulletins:
        if bulletin.get("date") == payload.date:
            target_bulletin = bulletin
            break
    
    if target_bulletin:
        # Déterminer les langues à vérifier
        langs_to_check = []
        if payload.language in [None, "all"]:
            langs_to_check = ["moore", "dioula"]
        elif payload.language in ["moore", "interpretation_moore"]:
            langs_to_check = ["moore"]
        elif payload.language in ["dioula", "interpretation_dioula"]:
            langs_to_check = ["dioula"]
        
        # Vérifier si toutes les traductions demandées existent déjà
        all_exist = True
        existing_translations = {}
        for lang in langs_to_check:
            field_name = f"interpretation_{lang}"
            translation = target_bulletin.get(field_name)
            if translation and len(translation.strip()) > 10:  # Au moins 10 caractères
                existing_translations[lang] = translation
            else:
                all_exist = False
                break
        
        # Si toutes les traductions existent, retourner immédiatement sans tâche
        if all_exist:
            logger.info(f"✅ Traductions déjà présentes pour {payload.date} ({', '.join(langs_to_check)}), aucune régénération nécessaire")
            return {
                "task_id": f"cached_{payload.date}_{payload.language}_{int(datetime.now().timestamp())}",
                "status": "completed",
                "message": "Les traductions existent déjà dans la base de données, aucune régénération nécessaire.",
                "translations": existing_translations,
                "cached": True,
            }
    
    # Créer la tâche
    task_manager = get_task_manager()
    task_id = task_manager.create_task(
        task_type="translation",
        metadata={
            "date": payload.date,
            "station_name": payload.station_name,
            "language": payload.language,
        }
    )
    
    # Fonction de traduction à exécuter dans le thread pool
    def _execute_translation():
        """Exécute la traduction de manière synchrone dans un thread séparé."""
        from backend.modules.language_interpreter import LanguageInterpreter
        
        # Récupérer les données de la station
        station_payloads = core.db_manager.list_bulletin_payloads_by_date(payload.date)
        target_station = None
        target_pdf_path = None
        is_generic = payload.station_name.lower() in ["bulletin national", "national", "all", "tout", "toutes"]
        
        for entry in station_payloads:
            if is_generic and entry.get("stations"):
                target_station = entry["stations"][0].copy()
                target_pdf_path = entry.get("pdf_path")
                break
            for station in entry.get("stations", []):
                if station.get("name") == payload.station_name:
                    target_station = station.copy()
                    target_pdf_path = entry.get("pdf_path")
                    break
            if target_station:
                target_station["pdf_path"] = target_pdf_path
                target_station["date"] = payload.date
                break
        
        if not target_station:
            if is_generic and station_payloads:
                for entry in station_payloads:
                    if entry.get("stations"):
                        target_station = entry["stations"][0].copy()
                        target_pdf_path = entry.get("pdf_path")
                        target_station["pdf_path"] = target_pdf_path
                        target_station["date"] = payload.date
                        break
            
            if not target_station:
                raise ValueError("Station ou bulletin non trouvé pour cette date.")
        
        # Interpréteur partagé
        interpreter = LanguageInterpreter.get_shared(core.db_manager)
        
        # ✨ Intégration de la nouvelle API de traduction en mooré
        def translate_with_external_api_sync(text: str, target_lang: str) -> str:
            """Version synchrone de la traduction via API externe"""
            if target_lang != "moore":
                return interpreter.translate(text, target_lang, force=True)
            
            import requests
            
            url = "https://fr-mos-translator-314397473739.europe-west1.run.app/api/translate"
            payload = {
                "text": text,
                "source_lang": "french",
                "target_lang": "moore"
            }
            
            try:
                response = requests.post(url, json=payload, timeout=30)
                if response.status_code == 200:
                    result = response.json()
                    return result.get("translation", "")
                else:
                    logger.warning(f"API externe a retourné le statut {response.status_code}")
                    return ""
            except Exception as e:
                logger.error(f"Erreur lors de la traduction via API externe : {e}")
                return ""
        
        # Générer le texte français si nécessaire
        if payload.language in [None, "all", "interpretation_francais", "fr", "francais"]:
            french_text = interpreter._generate_french_bulletin(target_station)
            if french_text:
                target_station["interpretation_francais"] = french_text
        
        french_text = target_station.get("interpretation_francais")
        if not french_text:
            for entry in station_payloads:
                if entry.get("interpretation_francais"):
                    french_text = entry.get("interpretation_francais")
                    target_station["interpretation_francais"] = french_text
                    break
        
        if not french_text:
            french_text = interpreter._generate_french_bulletin(target_station)
            if french_text:
                target_station["interpretation_francais"] = french_text
        
        if not french_text:
            raise ValueError("Impossible d'extraire le texte français du PDF.")
        
        # Déterminer les langues à régénérer
        langs_to_regen = []
        if payload.language in [None, "all"]:
            langs_to_regen = ["moore", "dioula"]
        elif payload.language in ["moore", "interpretation_moore"]:
            langs_to_regen = ["moore"]
        elif payload.language in ["dioula", "interpretation_dioula"]:
            langs_to_regen = ["dioula"]
        
        # Générer les traductions
        new_translations = {"fr": french_text}
        for lang in langs_to_regen:
            if lang == "moore":
                # Utiliser l'API externe pour le mooré
                translated = translate_with_external_api_sync(french_text, lang)
            else:
                # Utiliser l'interpréteur existant pour le dioula
                translated = interpreter.translate(french_text, lang, force=True)
            
            if translated:
                target_station[f"interpretation_{lang}"] = translated
                new_translations[lang] = translated
        
        # Détecter le type de bulletin
        raw_type = target_station.get("type") or (
            "forecast" if "forecast" in str(target_pdf_path).lower() or "prevision" in str(target_pdf_path).lower() else "observation"
        )
        type_map = {
            "prevision": "forecast",
            "prévision": "forecast",
            "forecast": "forecast",
            "observation": "observation",
            "obs": "observation"
        }
        bulletin_type_detected = type_map.get(str(raw_type).lower(), "observation")
        
        # Mise à jour de la base de données
        rows_updated = core.db_manager.update_bulletin_interpretations(
            payload.date,
            bulletin_type_detected,
            new_translations
        )
        logger.info(f"✅ Tâche {task_id}: {rows_updated} ligne(s) mise(s) à jour dans la BD")
        
        # Mise à jour du snapshot
        station_snapshot = target_station.copy()
        station_snapshot["interpretation_francais"] = None
        station_snapshot["interpretation_moore"] = None
        station_snapshot["interpretation_dioula"] = None
        core.db_manager.upsert_station_snapshot(target_pdf_path, station_snapshot)
        
        # Mise à jour du payload
        for entry in station_payloads:
            if entry.get("pdf_path") == target_pdf_path:
                for lang_key in ["fr", "moore", "dioula"]:
                    if lang_key in new_translations:
                        field_name = "interpretation_francais" if lang_key == "fr" else f"interpretation_{lang_key}"
                        entry[field_name] = new_translations[lang_key]
                
                for i, st in enumerate(entry.get("stations", [])):
                    if st.get("name") == target_station.get("name"):
                        entry["stations"][i] = station_snapshot
                        break
                
                core.db_manager.upsert_bulletin_payload(target_pdf_path, entry)
                break
        
        # Nettoyer le cache
        _cache_clear("bulletins:")
        
        return {
            "status": "success",
            "station": payload.station_name,
            "date": payload.date,
            "translations": new_translations,
            "rows_updated": rows_updated,
        }
    
    # Soumettre la tâche au pool de threads
    await task_manager.submit_translation_task(task_id, _execute_translation)
    
    # Retourner immédiatement l'ID de tâche
    return {
        "task_id": task_id,
        "status": "accepted",
        "message": "La tâche de traduction a été lancée en arrière-plan.",
        "poll_url": f"/bulletins/translation-task/{task_id}",
    }


@router.get("/bulletins/translation-task/{task_id}")
async def get_translation_task_status(task_id: str):
    """
    Récupère le statut d'une tâche de traduction.
    
    Statuts possibles :
    - pending: En attente de traitement
    - running: En cours d'exécution
    - completed: Terminée avec succès
    - failed: Échouée
    - cancelled: Annulée
    """
    task_manager = get_task_manager()
    task = task_manager.get_task(task_id)
    
    if not task:
        raise HTTPException(status_code=404, detail="Tâche introuvable.")
    
    response = {
        "task_id": task.task_id,
        "status": task.status.value,
        "task_type": task.task_type,
        "created_at": task.created_at.isoformat() if task.created_at else None,
        "started_at": task.started_at.isoformat() if task.started_at else None,
        "finished_at": task.finished_at.isoformat() if task.finished_at else None,
        "progress": task.progress,
        "metadata": task.metadata,
    }
    
    if task.status == TaskStatus.COMPLETED and task.result:
        response["result"] = task.result
    
    if task.status == TaskStatus.FAILED and task.error:
        response["error"] = task.error
    
    return response


@router.get("/bulletins/translation-tasks")
async def list_translation_tasks(
    status: Optional[str] = Query(None, enum=["pending", "running", "completed", "failed", "cancelled"])
):
    """
    Liste toutes les tâches de traduction.
    
    Optionnellement, filtre par statut.
    """
    task_manager = get_task_manager()
    all_tasks = task_manager.get_all_tasks()
    
    # Filtrer par statut si spécifié
    if status:
        filtered = {
            tid: task for tid, task in all_tasks.items()
            if task.status.value == status
        }
    else:
        filtered = all_tasks
    
    return {
        "tasks": [
            {
                "task_id": task.task_id,
                "status": task.status.value,
                "task_type": task.task_type,
                "created_at": task.created_at.isoformat() if task.created_at else None,
                "started_at": task.started_at.isoformat() if task.started_at else None,
                "finished_at": task.finished_at.isoformat() if task.finished_at else None,
                "metadata": task.metadata,
            }
            for task in filtered.values()
        ],
        "total": len(filtered),
        "running_count": task_manager.get_running_tasks_count(),
    }


@router.delete("/bulletins/translation-task/{task_id}")
async def cancel_translation_task(task_id: str):
    """
    Annule une tâche de traduction en attente.
    
    Note: Les tâches déjà en cours d'exécution ne peuvent pas être annulées
    car le modèle NLLB est déjà en train de générer.
    """
    task_manager = get_task_manager()
    success = task_manager.cancel_task(task_id)
    
    if not success:
        task = task_manager.get_task(task_id)
        if not task:
            raise HTTPException(status_code=404, detail="Tâche introuvable.")
        raise HTTPException(
            status_code=400,
            detail=f"Impossible d'annuler la tâche (statut actuel: {task.status.value})"
        )
    
    return {
        "task_id": task_id,
        "status": "cancelled",
        "message": "Tâche annulée avec succès.",
    }



@router.post("/bulletins/reprocess")
async def start_bulletins_reprocess(background_tasks: BackgroundTasks):
    """Relance l'extraction OCR + icônes sur tous les PDF enregistrés en base."""
    _ensure_db_ready()
    if core.db_manager is None or core.config is None:
        raise HTTPException(status_code=500, detail="Services non initialisés.")

    file_paths = core.db_manager.list_bulletin_file_paths()
    batch_id = str(uuid.uuid4())
    total = len(file_paths)

    core.db_manager.create_job(
        batch_id,
        "bulletin_reprocess",
        {"total": total},
    )

    progress = {
        "current": 0,
        "total": total,
        "success": 0,
        "failed": 0,
        "skipped": 0,
        "missing": 0,
    }
    core.db_manager.update_job(batch_id, status="pending", result={"progress": progress, "errors": []})

    if total == 0:
        core.db_manager.update_job(
            batch_id,
            status="completed",
            result={"progress": progress, "errors": []},
        )
        return {"batch_id": batch_id, "total": 0, "status": "completed", "message": "Aucun PDF à traiter."}

    def _job_runner():
        errors = []
        try:
            core.db_manager.update_job(batch_id, status="running", result={"progress": progress, "errors": errors})

            pdf_extractor = PDFExtractor(
                core.config.pdf_directory,
                core.config.output_directory,
            )
            temp_extractor = WorkflowTemperatureExtractor(roi_config_path=core.config.roi_config_path)
            icon_classifier = IconClassifier(roi_config_path=core.config.roi_config_path)
            data_integrator = DataIntegrator(core.db_manager)

            for index, file_path in enumerate(file_paths, start=1):
                try:
                    resolved_path = _resolve_pdf_path(
                        file_path,
                        core.config.pdf_directory,
                        core.config.project_root,
                    )
                    if resolved_path is None:
                        bulletin_records = core.db_manager.list_bulletins_by_file_path(file_path)
                        fallback_date = (
                            bulletin_records[0].get("date") if bulletin_records else None
                        ) or data_integrator._extract_bulletin_date(Path(file_path))
                        resolved_path = _try_redownload_pdf(
                            file_path,
                            fallback_date,
                            core.config.pdf_directory,
                            core.config.project_root,
                        )

                    if resolved_path is None:
                        progress["missing"] += 1
                        errors.append(f"{Path(file_path).name}: PDF introuvable, impossible de retélécharger.")
                    else:
                        error_message = _reprocess_pdf_entry(
                            file_path=file_path,
                            pdf_path=resolved_path,
                            db_manager=core.db_manager,
                            data_integrator=data_integrator,
                            pdf_extractor=pdf_extractor,
                            temp_extractor=temp_extractor,
                            icon_classifier=icon_classifier,
                        )
                        if error_message:
                            progress["failed"] += 1
                            errors.append(f"{Path(file_path).name}: {error_message}")
                        else:
                            progress["success"] += 1
                except Exception as exc:
                    progress["failed"] += 1
                    errors.append(f"{Path(file_path).name}: {exc}")
                finally:
                    progress["current"] = index
                    core.db_manager.update_job(batch_id, result={"progress": progress, "errors": errors})

            core.db_manager.update_job(
                batch_id,
                status="completed",
                result={"progress": progress, "errors": errors},
            )
            _cache_clear("bulletins:")
        except Exception as exc:
            core.db_manager.update_job(
                batch_id,
                status="failed",
                error_message=str(exc),
                result={"progress": progress, "errors": errors},
            )

    background_tasks.add_task(run_in_threadpool, _job_runner)

    return {
        "batch_id": batch_id,
        "total": total,
        "status": "pending",
        "message": "Ré-extraction lancée en arrière-plan.",
    }


@router.get("/bulletins/reprocess/{batch_id}")
async def get_bulletins_reprocess_status(batch_id: str):
    """Retourne le statut d'une ré-extraction globale."""
    _ensure_db_ready()
    if core.db_manager is None:
        raise HTTPException(status_code=500, detail="Base de données indisponible.")

    job = core.db_manager.get_job(batch_id)
    if not job or job.get("job_type") != "bulletin_reprocess":
        raise HTTPException(status_code=404, detail="Traitement introuvable.")

    result = job.get("result") or {}
    progress = result.get("progress") or {
        "current": 0,
        "total": (job.get("payload") or {}).get("total", 0),
        "success": 0,
        "failed": 0,
        "skipped": 0,
        "missing": 0,
    }

    return {
        "batch_id": batch_id,
        "status": job.get("status"),
        "progress": progress,
        "errors": result.get("errors") or [],
        "error": job.get("error_message"),
    }
