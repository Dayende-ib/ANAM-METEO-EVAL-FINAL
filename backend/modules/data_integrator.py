#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""Integre et structure les sorties OCR et detection dans la base ANAM."""

import difflib
import json
import os
import re
import unicodedata
from collections import defaultdict
from datetime import datetime
from pathlib import Path

import pandas as pd

from backend.modules.data_validator import DataValidator


class DataIntegrator:
    """Assemble les differentes extractions avant evaluation ou export."""

    def __init__(self, db_manager):
        self.db_manager = db_manager
        self.allow_unknown_stations = os.getenv("ALLOW_UNKNOWN_STATIONS", "0").lower() in {
            "1",
            "true",
            "yes",
        }
        self.unknown_station_name = os.getenv("UNKNOWN_STATION_NAME", "Station_Inconnue")
        self.validator = DataValidator()
        self._init_stations()

    def _init_stations(self):
        """Cree au moins une station afin de rattacher les mesures extraites."""
        self.stations_map = {
            "Ouagadougou": {"lat": 12.35, "lon": -1.52},
            "Bobo-Dioulasso": {"lat": 11.17, "lon": -4.32},
            "Dori": {"lat": 14.03, "lon": -0.03},
            "Fada N'Gourma": {"lat": 12.07, "lon": 0.35},
            "Ouahigouya": {"lat": 13.58, "lon": -2.43},
            "Dédougou": {"lat": 12.47, "lon": -3.48},
            "Boromo": {"lat": 11.75, "lon": -2.93},
            "Gaoua": {"lat": 10.33, "lon": -3.18},
            "Pô": {"lat": 11.17, "lon": -1.15},
            "Bogandé": {"lat": 12.98, "lon": -0.13},
        }

        for name, coords in self.stations_map.items():
            self.db_manager.insert_station(
                name,
                coords.get("lat"),
                coords.get("lon"),
            )

        self._build_station_lookup()

    def _build_station_lookup(self):
        self.station_lookup = {}
        for name in self.stations_map.keys():
            self.station_lookup[self._normalize_station_key(name)] = name

        aliases = {
            "ouaga": "Ouagadougou",
            "ouagadougo": "Ouagadougou",
            "ouagadougu": "Ouagadougou",
            "bobodioulasso": "Bobo-Dioulasso",
            "bobodiolasso": "Bobo-Dioulasso",
            "fadan_gourma": "Fada N'Gourma",
            "fadangourma": "Fada N'Gourma",
            "dedougou": "Dédougou",
            "bogande": "Bogandé",
            "po": "Pô",
        }
        self.station_aliases = {
            self._normalize_station_key(alias): self._normalize_station_key(target)
            for alias, target in aliases.items()
        }

    def _normalize_station_key(self, value):
        if not value:
            return ""
        text = value.strip().lower()
        text = unicodedata.normalize("NFKD", text)
        text = "".join(ch for ch in text if not unicodedata.combining(ch))
        text = re.sub(r"[^a-z0-9]", "", text)
        return text

    def _extract_bulletin_date(self, pdf_path: Path):
        """Tente de deduire la date du bulletin depuis le nom du fichier."""
        stem = pdf_path.stem

        match = re.search(r"(\d{1,2})[_\- ]+([^\W\d_]+)[_\- ]+(\d{4})", stem)
        if not match:
            return None

        day = int(match.group(1))
        month_fr = match.group(2).lower()
        year = int(match.group(3))

        translation = str.maketrans(
            {
                "\u00e0": "a",
                "\u00e2": "a",
                "\u00e4": "a",
                "\u00e9": "e",
                "\u00e8": "e",
                "\u00ea": "e",
                "\u00eb": "e",
                "\u00ee": "i",
                "\u00ef": "i",
                "\u00f4": "o",
                "\u00f6": "o",
                "\u00f9": "u",
                "\u00fb": "u",
                "\u00fc": "u",
                "\u00e7": "c",
            }
        )
        month_fr = month_fr.translate(translation)

        mois_map = {
            "janvier": 1,
            "fevrier": 2,
            "mars": 3,
            "avril": 4,
            "mai": 5,
            "juin": 6,
            "juillet": 7,
            "aout": 8,
            "septembre": 9,
            "octobre": 10,
            "novembre": 11,
            "decembre": 12,
        }
        month_num = mois_map.get(month_fr)
        if not month_num:
            return None

        try:
            return datetime(year, month_num, day).strftime("%Y-%m-%d")
        except ValueError:
            return None

    def integrate_data(self, temperature_data, icon_data):
        """Fusionne les informations OCR et icones puis alimente la base."""
        integrated_data = []

        icon_index = self._index_icon_data(icon_data)
        for temp_pdf_data in temperature_data or []:
            pdf_key = self._normalize_pdf_key(temp_pdf_data.get("pdf_path"))
            icon_pdf_data = icon_index.get(
                pdf_key,
                {"pdf_path": temp_pdf_data.get("pdf_path"), "data": []},
            )
            pdf_path = Path(temp_pdf_data["pdf_path"])
            date_str = self._extract_bulletin_date(pdf_path)
            if date_str is None:
                date_str = datetime.today().strftime("%Y-%m-%d")

            station_records = {}
            pdf_record = {
                "pdf_path": str(pdf_path),
                "date": date_str,
                "stations": [],
            }

            aligned_maps = self._align_map_pages(
                temp_pdf_data.get("data", []),
                icon_pdf_data.get("data", []),
            )

            for map_type, temps, icons in aligned_maps:
                normalized_type = map_type if map_type in {"observation", "forecast"} else "observation"
                stations_data = self.combine_page_data(temps, icons)

                bulletin_id = self.db_manager.insert_bulletin(
                    date_str,
                    normalized_type,
                    str(pdf_path),
                    pdf_path.stem,
                )

                for station in stations_data:
                    station_name = self._resolve_station_name(station.get("name"))
                    if not station_name:
                        continue
                    coords = self.stations_map.get(
                        station_name,
                        {"lat": None, "lon": None},
                    )
                    station_id = self.db_manager.insert_station(
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
                    measurement = self._enforce_temperature_rules(measurement)
                    measurement, warnings, issues = self.validator.validate_measurement(
                        station_name,
                        measurement,
                        normalized_type,
                        date_str,
                    )

                    # Persistance de la mesure pour exploitation future.
                    self.db_manager.insert_weather_data(
                        bulletin_id=bulletin_id,
                        station_id=station_id,
                        tmin=measurement["tmin"],
                        tmax=measurement["tmax"],
                        weather_condition=measurement["weather_condition"],
                        tmin_raw=measurement["tmin_raw"],
                        tmax_raw=measurement["tmax_raw"],
                    )

                    for issue in issues:
                        self.db_manager.insert_data_issue(
                            bulletin_id=bulletin_id,
                            station_id=station_id,
                            bulletin_date=date_str,
                            map_type=normalized_type,
                            code=issue.get("code"),
                            message=issue.get("message"),
                            severity=issue.get("severity"),
                            details={"station": station_name},
                        )

                    record = station_records.setdefault(
                        station_name,
                        self._build_station_record(station_name, coords),
                    )
                    target_slot = "prevision" if normalized_type == "forecast" else normalized_type
                    record[target_slot] = self._merge_measurements(
                        record.get(target_slot, {}),
                        measurement,
                    )
                    record["last_bbox"] = measurement.get("bbox") or record.get("last_bbox")
                    if warnings:
                        record["validation_errors"].extend(warnings)

            for record in station_records.values():
                self._finalize_station_record(record)
                pdf_record["stations"].append(record)

            integrated_data.append(pdf_record)

        print("Donnees integrees et sauvegardees dans la base de donnees.")
        return integrated_data

    def _normalize_pdf_key(self, pdf_path):
        if not pdf_path:
            return None
        try:
            resolved = Path(pdf_path).resolve()
        except Exception:
            resolved = Path(str(pdf_path))
        return os.path.normcase(str(resolved))

    def _index_icon_data(self, icon_data):
        index = {}
        for entry in icon_data or []:
            key = self._normalize_pdf_key(entry.get("pdf_path"))
            if key:
                index[key] = entry
        return index

    def _align_map_pages(self, temp_maps, icon_maps):
        """Aligne les pages observation/prevision meme si une detection manque."""
        if not temp_maps and not icon_maps:
            return []

        icons_by_type = defaultdict(list)
        for entry in icon_maps:
            icons_by_type[entry.get("type")].extend(entry.get("icons", []))

        aligned = []
        for temp_entry in temp_maps:
            map_type = temp_entry.get("type", "observation")
            if map_type not in {"observation", "forecast"}:
                map_type = "observation"
            temps = temp_entry.get("temperatures", [])
            aligned.append((map_type, temps, icons_by_type.get(map_type, [])))

        # Cas rare: icons presentes sans OCR (on ajoute quand meme).
        mapped_types = set()
        for entry in temp_maps:
            entry_type = entry.get("type", "observation")
            if entry_type not in {"observation", "forecast"}:
                entry_type = "observation"
            mapped_types.add(entry_type)
        for icon_entry in icon_maps:
            map_type = icon_entry.get("type")
            if map_type not in {"observation", "forecast"}:
                map_type = "observation"
            if map_type not in mapped_types:
                aligned.append((map_type or "observation", [], icon_entry.get("icons", [])))

        return aligned

    def _resolve_station_name(self, raw_name):
        """Retourne un nom de station exploitable sans masquer les inconnues."""
        if raw_name and isinstance(raw_name, str):
            clean = raw_name.strip()
            if clean:
                normalized = self._normalize_station_key(clean)
                if normalized in self.station_aliases:
                    normalized = self.station_aliases[normalized]
                if normalized in self.station_lookup:
                    return self.station_lookup[normalized]
                match = difflib.get_close_matches(
                    normalized,
                    self.station_lookup.keys(),
                    n=1,
                    cutoff=0.85,
                )
                if match:
                    return self.station_lookup[match[0]]

        if self.allow_unknown_stations:
            return self.unknown_station_name
        return None

    def _build_station_record(self, station_name, coords):
        return {
            "name": station_name,
            "latitude": coords.get("lat"),
            "longitude": coords.get("lon"),
            "observation": {
                "tmin": None,
                "tmax": None,
                "weather_condition": None,
                "confidence": None,
                "tmin_raw": None,
                "tmax_raw": None,
            },
            "prevision": {
                "tmin": None,
                "tmax": None,
                "weather_condition": None,
                "confidence": None,
                "tmin_raw": None,
                "tmax_raw": None,
            },
            "last_bbox": None,
            "validation_errors": [],
        }

    def _merge_measurements(self, base_measure, new_measure):
        if not base_measure:
            base_measure = {}
        merged = base_measure.copy()
        for key, value in new_measure.items():
            if value is not None:
                merged[key] = value
        return merged

    def _finalize_station_record(self, record):
        """Derive les champs resumes utilises par les autres modules."""
        preferred = record.get("prevision") or {}
        fallback = record.get("observation") or {}

        if preferred and any(val is not None for val in preferred.values()):
            summary = preferred
            record["type"] = "prevision"
        elif fallback:
            summary = fallback
            record["type"] = "observation"
        else:
            summary = {}
            record["type"] = "unknown"

        record["tmin"] = summary.get("tmin") or fallback.get("tmin")
        record["tmax"] = summary.get("tmax") or fallback.get("tmax")
        record["weather_condition"] = summary.get("weather_condition") or fallback.get(
            "weather_condition"
        )
        record["confidence"] = summary.get("confidence") or fallback.get("confidence")
        record["tmin_raw"] = summary.get("tmin_raw") or fallback.get("tmin_raw")
        record["tmax_raw"] = summary.get("tmax_raw") or fallback.get("tmax_raw")
        record["quality_score"] = summary.get("quality_score") or fallback.get("quality_score")
        record["validation_status"] = "ok" if not record.get("validation_errors") else "warning"

    @staticmethod
    def _enforce_temperature_rules(measurement):
        tmin = measurement.get("tmin")
        tmax = measurement.get("tmax")
        if tmax is not None and tmax < 30:
            measurement["tmax"] = 30.0
            tmax = measurement["tmax"]
        if tmin is not None and tmax is not None and tmax < tmin:
            measurement["tmax"] = max(tmin, 30.0)
        return measurement

    def combine_page_data(self, temperatures, icons):
        """Associe chaque couple Tmin/Tmax avec l'icone detectee sur la carte."""
        if not temperatures and not icons:
            return []

        station_map = {}
        anon_index = 0

        def get_entry(name):
            nonlocal anon_index
            key = name or f"__anon_{anon_index}"
            if not name:
                anon_index += 1
            entry = station_map.setdefault(
                key,
                {
                    "name": name,
                    "bbox": None,
                    "tmin": None,
                    "tmax": None,
                    "tmin_raw": None,
                    "tmax_raw": None,
                    "weather_condition": None,
                    "confidence": None,
                },
            )
            return entry

        for temp_data in temperatures:
            entry = get_entry(temp_data.get("name"))
            entry["bbox"] = temp_data.get("bbox") or entry.get("bbox")
            if temp_data.get("tmin") is not None:
                entry["tmin"] = temp_data.get("tmin")
            if temp_data.get("tmax") is not None:
                entry["tmax"] = temp_data.get("tmax")
            if temp_data.get("tmin_raw") is not None:
                entry["tmin_raw"] = temp_data.get("tmin_raw")
            if temp_data.get("tmax_raw") is not None:
                entry["tmax_raw"] = temp_data.get("tmax_raw")

        for icon in icons:
            entry = get_entry(icon.get("name"))
            entry["weather_condition"] = icon.get("weather_condition")
            entry["confidence"] = icon.get("confidence")

        return list(station_map.values())

    def convert_to_csv_format(self, interpreted_data):
        """Aplati la structure hierarchique pour faciliter l'export CSV."""
        rows = []
        for pdf in interpreted_data:
            pdf_path = pdf.get("pdf_path")
            for station in pdf.get("stations", []):
                observation = station.get("observation", {})
                prevision = station.get("prevision", {})
                row = {
                    "pdf_path": pdf_path,
                    "name": station.get("name"),
                    "latitude": station.get("latitude"),
                    "longitude": station.get("longitude"),
                    "type": station.get("type"),
                    "tmin": station.get("tmin"),
                    "tmax": station.get("tmax"),
                    "weather_condition": station.get("weather_condition"),
                    "tmin_obs": observation.get("tmin"),
                    "tmax_obs": observation.get("tmax"),
                    "weather_obs": observation.get("weather_condition"),
                    "tmin_prev": prevision.get("tmin"),
                    "tmax_prev": prevision.get("tmax"),
                    "weather_prev": prevision.get("weather_condition"),
                    "validation_status": station.get("validation_status"),
                    "validation_errors": "; ".join(station.get("validation_errors", [])) or None,
                }
                for key, value in station.items():
                    if key.startswith("interpretation_"):
                        row[key] = value
                rows.append(row)

        if not rows:
            return pd.DataFrame()

        return pd.DataFrame(rows)

    def save_final_dataset(self, interpreted_data, output_directory):
        """Sauvegarde les resultats interpretes en JSON/CSV et persiste dans la DB."""
        self._persist_interpretations_to_db(interpreted_data)

        out_dir = Path(output_directory)
        out_dir.mkdir(parents=True, exist_ok=True)

        json_path = out_dir / "resultats_interpretes.json"
        with open(json_path, "w", encoding="utf-8") as handle:
            json.dump(interpreted_data, handle, ensure_ascii=False, indent=2)

        df = self.convert_to_csv_format(interpreted_data)
        if not df.empty:
            csv_path = out_dir / "resultats_interpretes.csv"
            df.to_csv(csv_path, index=False, encoding="utf-8")

        print(f"Resultats finaux sauvegardes dans {out_dir}")

    def _persist_interpretations_to_db(self, interpreted_data):
        if not interpreted_data:
            return
        for entry in interpreted_data:
            pdf_path = entry.get("pdf_path")
            if not pdf_path:
                continue
            
            # Persister les interprétations globales du bulletin (Demande utilisateur SN2025)
            bulletin_date = entry.get("date")
            bulletin_type = entry.get("type")
            bulletin_texts = {
                "fr": entry.get("interpretation_francais"),
                "moore": entry.get("interpretation_moore"),
                "dioula": entry.get("interpretation_dioula"),
            }
            if any(bulletin_texts.values()) and bulletin_date and bulletin_type:
                try:
                    self.db_manager.update_bulletin_interpretations(bulletin_date, bulletin_type, bulletin_texts)
                except Exception as exc:
                    print(f"  !! Impossible de persister les interpretations globales pour {bulletin_date}: {exc}")

            try:
                self.db_manager.upsert_bulletin_payload(pdf_path, entry)
            except Exception as exc:
                print(f"  !! Impossible de persister le payload pour {pdf_path}: {exc}")
            for station in entry.get("stations", []):
                station_payload = dict(station)
                if (
                    station_payload.get("interpretation_francais") is None
                    and station_payload.get("interpretation_fr") is not None
                ):
                    station_payload["interpretation_francais"] = station_payload.get("interpretation_fr")
                try:
                    self.db_manager.upsert_station_snapshot(pdf_path, station_payload)
                except Exception as exc:
                    station_name = station_payload.get("name") or "station_sans_nom"
                    print(f"  !! Impossible de persister le snapshot pour {station_name}: {exc}")

                station_name = station_payload.get("name")
                texts = {
                    "fr": station_payload.get("interpretation_francais")
                    or station_payload.get("interpretation_fr"),
                    "moore": station_payload.get("interpretation_moore"),
                    "dioula": station_payload.get("interpretation_dioula"),
                }
                if not any(texts.values()):
                    continue
                bulletin_type = station_payload.get("type")
                try:
                    self.db_manager.update_station_interpretations(pdf_path, station_name, bulletin_type, texts)
                except Exception as exc:
                    print(f"  !! Impossible de persister les interpretations pour {station_name}: {exc}")
