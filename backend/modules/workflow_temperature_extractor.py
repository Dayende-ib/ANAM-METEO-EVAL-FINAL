#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""Extracteur de températures utilisant uniquement les méthodes locales et ROI."""

import json
import logging
import os
from pathlib import Path

import cv2

from backend.modules.temperature_extractor import TemperatureExtractor

logger = logging.getLogger(__name__)


class WorkflowTemperatureExtractor(TemperatureExtractor):
    """Extraction OCR basée uniquement sur les ROI configurés localement."""

    def __init__(self, roi_config_path=None):
        # Utilise le config_roi.json par défaut
        if not roi_config_path:
            roi_config_path = Path(__file__).parent.parent / "config_roi.json"
        
        super().__init__(roi_config_path=roi_config_path)
        logger.info("Extracteur de températures initialisé avec configuration ROI locale")

    def extract_temperatures_from_workflow(self, pdf_results):
        """
        Extrait les températures en utilisant les ROI, avec un fallback intelligent 
        par proximité géographique si le ROI échoue.
        """
        all_temperatures = []

        for pdf_result in pdf_results:
            pdf_temps_data = {
                "pdf_path": pdf_result["pdf_path"],
                "image_path": pdf_result.get("image_path"),
                "data": [],
            }

            for map_data in pdf_result.get("maps", []):
                map_type = map_data.get("type")
                map_image_path = map_data.get("image_path") or pdf_result.get("image_path")
                
                # 1. Extraction directe via ROI
                temps = self._extract_temperatures_from_rois(map_image_path)
                
                # 2. Si des stations manquent, faire une extraction globale et matcher par distance
                missing_stations = self._get_missing_stations(temps)
                if missing_stations:
                    try:
                        global_detections = self.extract_temperature_values(map_image_path, None)
                        if global_detections:
                            fallback_temps = self._match_detections_to_stations(global_detections, missing_stations)
                            temps.extend(fallback_temps)
                            logger.info(f"Fallback géographique pour {map_image_path} : {len(fallback_temps)} stations récupérées.")
                    except Exception as exc:
                        logger.warning(f"Échec du fallback global pour {map_image_path}: {exc}")

                pdf_temps_data["data"].append({
                    "type": map_type,
                    "temperatures": temps,
                })

            all_temperatures.append(pdf_temps_data)
        return all_temperatures

    def _get_missing_stations(self, current_temps):
        """Identifie les stations de la config ROI qui n'ont pas de détection."""
        detected_names = {t.get("name") for t in current_temps if t.get("name")}
        return [name for name in self.roi_config.keys() if name not in detected_names]

    def _match_detections_to_stations(self, detections, missing_station_names):
        """Associe les détections sans nom aux stations manquantes les plus proches."""
        import math
        matched = []
        # On ne garde que les détections qui n'ont pas encore de nom
        anonymous_detections = [d for d in detections if not d.get("name")]
        
        for station_name in missing_station_names:
            rois = self.roi_config.get(station_name, {})
            # Centre théorique de la station (moyenne des ROI tmin/tmax)
            tmin_roi = rois.get("tmin_roi")
            tmax_roi = rois.get("tmax_roi")
            if not tmin_roi and not tmax_roi: continue
            
            ref_roi = tmin_roi or tmax_roi
            target_cx = (ref_roi[0] + ref_roi[2]) / 2
            target_cy = (ref_roi[1] + ref_roi[3]) / 2
            
            best_det = None
            min_dist = 150 # Seuil de 150 pixels pour éviter les faux positifs lointains
            
            for det in anonymous_detections:
                bbox = det.get("bbox")
                if not bbox: continue
                det_cx = bbox[0] + bbox[2]/2
                det_cy = bbox[1] + bbox[3]/2
                
                dist = math.hypot(det_cx - target_cx, det_cy - target_cy)
                if dist < min_dist:
                    min_dist = dist
                    best_det = det
            
            if best_det:
                new_det = best_det.copy()
                new_det["name"] = station_name
                new_det["confidence"] = (new_det.get("confidence") or 0.5) * 0.9 # Pénalité légère car fallback
                matched.append(new_det)
                # Optionnel : retirer de anonymous_detections pour ne pas l'utiliser deux fois
                if best_det in anonymous_detections:
                    anonymous_detections.remove(best_det)
                    
        return matched

    # Méthodes héritées désactivées - renvoient des résultats vides
    def _load_workflow_from_disk(self, image_path):
        """Désactivé - ne charge plus de prédictions externes."""
        return None

    def _extract_temperatures_from_workflow_map(self, image_path, workflow_result, map_bbox):
        """Désactivé - utilise uniquement l'extraction ROI locale."""
        return self._extract_temperatures_from_rois(image_path)

    def _extract_city_candidates(self, image, predictions):
        """Désactivé - pas nécessaire pour l'approche ROI locale."""
        return []

    def _ocr_city_name(self, crop):
        """Désactivé - pas utilisé dans l'approche ROI."""
        return None

    def _ocr_temperature_crop(self, crop):
        gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)
        gray = cv2.resize(gray, None, fx=2.0, fy=2.0, interpolation=cv2.INTER_LINEAR)
        _, thresh = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
        try:
            text = pytesseract.image_to_string(
                thresh,
                config="--psm 7 -c tessedit_char_whitelist=0123456789/NPnp",
                timeout=self.ocr_timeout,
            )
        except Exception:
            return (None, None, None, None, None)

        clean = (text or "").strip()
        pattern = re.compile(r"^(\d{1,2}|np)\s*/\s*(\d{1,2}|np)$", re.IGNORECASE)
        match = pattern.match(clean)
        if not match:
            return (None, None, None, None, clean or None)
        raw_tmin = match.group(1)
        raw_tmax = match.group(2)
        tmin = self._value_from_token(raw_tmin)
        tmax = self._value_from_token(raw_tmax)
        return (tmin, tmax, raw_tmin.upper(), raw_tmax.upper(), clean)

    def _match_nearest_city(self, bbox, cities):
        """Désactivé - l'association se fait via ROI."""
        return None

    def _crop_bbox(self, image, bbox):
        x, y, w, h = bbox
        if w <= 0 or h <= 0:
            return None
        height, width = image.shape[:2]
        x1 = max(0, x)
        y1 = max(0, y)
        x2 = min(width, x + w)
        y2 = min(height, y + h)
        if x2 <= x1 or y2 <= y1:
            return None
        return image[y1:y2, x1:x2]

    @staticmethod
    def _bbox_center(bbox):
        x, y, w, h = bbox
        return (x + w / 2.0, y + h / 2.0)
