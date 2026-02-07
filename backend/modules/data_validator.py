#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""Validation et nettoyage des donnees meteo extraites."""

import json
import os
import re
from pathlib import Path
from typing import Dict, List, Tuple, Optional


class DataValidator:
    """Applique des regles simples pour securiser Tmin/Tmax et signaler les anomalies."""

    def __init__(
        self,
        tmin_range: Tuple[float, float] = (15.0, 40.0),
        tmax_range: Tuple[float, float] = (30.0, 55.0),
    ):
        self.tmin_range = tmin_range
        self.tmax_range = tmax_range
        self.rules = self._load_rules()

    def validate_measurement(
        self,
        station_name: str,
        measurement: Dict[str, Optional[float]],
        map_type: str,
        bulletin_date: Optional[str] = None,
    ) -> Tuple[Dict[str, Optional[float]], List[str], List[Dict[str, str]]]:
        """Nettoie une mesure observation/prevision et remonte les anomalies eventuelles."""
        
        # Validation des entrées
        if not isinstance(station_name, str) or not station_name.strip():
            raise ValueError("Nom de station invalide")
        
        if not isinstance(measurement, dict):
            raise ValueError("Mesure doit être un dictionnaire")
        
        # Validation du type de carte
        valid_map_types = {"observation", "forecast", "prediction"}
        if map_type not in valid_map_types:
            raise ValueError(f"Type de carte invalide: {map_type}")
        
        # Validation de la date si fournie
        if bulletin_date is not None:
            if not isinstance(bulletin_date, str):
                raise ValueError("Date du bulletin doit être une chaîne")
            # Format attendu: YYYY-MM-DD
            if not re.match(r'^\d{4}-\d{2}-\d{2}$', bulletin_date):
                raise ValueError("Format de date invalide, attendu: YYYY-MM-DD")
        """Nettoie une mesure observation/prevision et remonte les anomalies eventuelles."""
        cleaned = measurement.copy()
        warnings: List[str] = []
        issues: List[Dict[str, str]] = []

        tmin_range, tmax_range = self._resolve_ranges(station_name, bulletin_date)

        cleaned["tmin"], w_tmin = self._sanitize_value(
            measurement.get("tmin"),
            tmin_range,
            station_name,
            "tmin",
            map_type,
        )
        warnings.extend(w_tmin)
        issues.extend(self._issues_from_warnings(w_tmin, "tmin"))

        cleaned["tmax"], w_tmax = self._sanitize_value(
            measurement.get("tmax"),
            tmax_range,
            station_name,
            "tmax",
            map_type,
        )
        warnings.extend(w_tmax)
        issues.extend(self._issues_from_warnings(w_tmax, "tmax"))

        tmin = cleaned.get("tmin")
        tmax = cleaned.get("tmax")
        if tmax is not None and tmax < 30:
            cleaned["tmax"] = 30.0
            warnings.append(f"[{map_type}] tmax trop bas ({tmax}) sur {station_name}, corrige a 30.")
            issues.append(
                {
                    "code": "TMAX_TOO_LOW",
                    "message": f"tmax trop bas ({tmax}), corrige a 30.",
                    "severity": "warning",
                }
            )
            tmax = cleaned.get("tmax")
        if tmin is not None and tmax is not None:
            if tmax < tmin:
                corrected = max(tmin, 30.0)
                cleaned["tmax"] = corrected
                warnings.append(f"[{map_type}] tmax < tmin sur {station_name}, corrige a {corrected}.")
                issues.append({
                    "code": "TMAX_BELOW_TMIN",
                    "message": f"tmax < tmin, corrige a {corrected}.",
                    "severity": "warning",
                })
            elif (tmax - tmin) < 4.0:
                warnings.append(f"[{map_type}] Amplitude thermique suspecte ({tmax-tmin}C) sur {station_name}.")
                issues.append({
                    "code": "LOW_THERMAL_AMPLITUDE",
                    "message": f"Amplitude thermique suspecte ({tmax-tmin}C). Vérifiez l'OCR.",
                    "severity": "info",
                })

        cleaned["quality_score"] = self._compute_quality_score(warnings)
        return cleaned, warnings, issues

    def _sanitize_value(
        self,
        value: Optional[float],
        valid_range: Tuple[float, float],
        station_name: str,
        field_name: str,
        map_type: str,
    ) -> Tuple[Optional[float], List[str]]:
        warnings: List[str] = []

        # Validation du nom de station
        if not isinstance(station_name, str) or not station_name.strip():
            warnings.append(f"[{map_type}] Nom de station invalide.")
            return None, warnings

        # Validation du nom de champ
        valid_fields = {"tmin", "tmax"}
        if field_name not in valid_fields:
            warnings.append(f"[{map_type}] Champ invalide: {field_name}")
            return None, warnings

        if value is None:
            return None, warnings

        numeric: Optional[float] = None
        if isinstance(value, (int, float)):
            numeric = float(value)
        elif isinstance(value, str):
            text = value.strip()
            if not text:
                warnings.append(f"[{map_type}] {field_name} vide pour {station_name}.")
                return None, warnings
            try:
                numeric = float(text)
            except (TypeError, ValueError):
                warnings.append(f"[{map_type}] {field_name} illisible pour {station_name} ({value!r}).")
                return None, warnings
        else:
            warnings.append(
                f"[{map_type}] {field_name} type invalide pour {station_name} ({type(value).__name__})."
            )
            return None, warnings

        if numeric is None or not (-1000 <= numeric <= 1000):
            warnings.append(
                f"[{map_type}] {field_name}={numeric}C valeur hors limites raisonnables pour {station_name}."
            )
            return None, warnings

        if not (valid_range[0] <= numeric <= valid_range[1]):
            warnings.append(
                f"[{map_type}] {field_name}={numeric}C hors plage {valid_range} pour {station_name}."
            )
            return None, warnings

        return round(numeric, 1), warnings

    def _load_rules(self) -> Dict:
        rules_path = os.getenv("VALIDATION_RULES_PATH")
        
        # Validation stricte du chemin
        if rules_path:
            # Nettoyage et validation du chemin
            rules_path = rules_path.strip()
            # Empêcher les path traversal
            if ".." in rules_path or "~" in rules_path:
                raise ValueError("Chemin invalide: path traversal détecté")
            
            path = Path(rules_path)
            if not path.is_absolute():
                path = Path(__file__).resolve().parent.parent / path
        else:
            path = Path(__file__).resolve().parent.parent / "config" / "validation_rules.json"
        
        # Vérifications de sécurité
        if not path.exists():
            return {}
        
        # Vérifier que c'est bien un fichier régulier
        if not path.is_file():
            raise ValueError(f"Le chemin {path} n'est pas un fichier valide")
        
        # Limiter la taille du fichier (ex: 1MB max)
        MAX_FILE_SIZE = 5120 * 5120  # 5MB
        if path.stat().st_size > MAX_FILE_SIZE:
            raise ValueError(f"Fichier trop volumineux: {path.stat().st_size} bytes")
        
        try:
            content = path.read_text(encoding="utf-8")
            # Validation basique du contenu JSON
            if not content.strip().startswith('{') and not content.strip().startswith('['):
                raise ValueError("Contenu JSON invalide")
            
            return json.loads(content)
        except (json.JSONDecodeError, UnicodeDecodeError) as e:
            raise ValueError(f"Fichier JSON invalide: {str(e)}")
        except Exception as e:
            raise ValueError(f"Erreur lors du chargement des règles: {str(e)}")

    def _resolve_ranges(
        self,
        station_name: str,
        bulletin_date: Optional[str],
    ) -> Tuple[Tuple[float, float], Tuple[float, float]]:
        defaults = self.rules.get("defaults") if isinstance(self.rules, dict) else None
        tmin_range = tuple(defaults.get("tmin_range", self.tmin_range)) if defaults else self.tmin_range
        tmax_range = tuple(defaults.get("tmax_range", self.tmax_range)) if defaults else self.tmax_range

        month_key = None
        if bulletin_date and isinstance(bulletin_date, str) and len(bulletin_date) >= 7:
            month_key = bulletin_date[5:7]
        month_rules = self.rules.get("months", {}).get(month_key) if month_key else None
        if month_rules:
            tmin_range = tuple(month_rules.get("tmin_range", tmin_range))
            tmax_range = tuple(month_rules.get("tmax_range", tmax_range))

        station_rules = self.rules.get("stations", {}).get(station_name)
        if station_rules:
            tmin_range = tuple(station_rules.get("tmin_range", tmin_range))
            tmax_range = tuple(station_rules.get("tmax_range", tmax_range))

        return (tmin_range[0], tmin_range[1]), (tmax_range[0], tmax_range[1])

    @staticmethod
    def _compute_quality_score(warnings: List[str]) -> float:
        base = 1.0
        penalty = 0.1 * len(warnings)
        return max(0.0, round(base - penalty, 2))

    @staticmethod
    def _issues_from_warnings(warnings: List[str], field_name: str) -> List[Dict[str, str]]:
        issues: List[Dict[str, str]] = []
        for warning in warnings:
            issues.append(
                {
                    "code": f"INVALID_{field_name.upper()}",
                    "message": warning,
                    "severity": "warning",
                }
            )
        return issues
