#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""Extraction OCR des couples Tmin/Tmax depuis les cartes ANAM."""

import json
import logging
import os
import re
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import cv2
import numpy as np
import pytesseract
from pytesseract import Output

logger = logging.getLogger(__name__)


class TemperatureExtractor:
    """Centralise le pretraitement et la lecture OCR des temperatures."""

    def __init__(self, roi_config_path=None):
        self.roi_config = self._load_roi_config(roi_config_path)
        self.drop_unmapped = os.getenv("TEMPERATURE_DROP_UNKNOWN", "1").lower() in {
            "1",
            "true",
            "yes",
        }
        self.verbose = os.getenv("TEMPERATURE_VERBOSE", "1").lower() in {"1", "true", "yes"}
        self.roi_match_tolerance = int(os.getenv("TEMPERATURE_ROI_TOLERANCE_PX", "6"))
        self.ocr_upscale = float(os.getenv("TEMPERATURE_OCR_UPSCALE", "2.0"))
        self.roi_base_width = int(os.getenv("ROI_BASE_WIDTH", "0"))
        self.roi_base_height = int(os.getenv("ROI_BASE_HEIGHT", "0"))
        self._roi_lookup = self._build_roi_lookup()
        timeout_value = float(os.getenv("TEMPERATURE_OCR_TIMEOUT_SECONDS", "0"))
        self.ocr_timeout = timeout_value if timeout_value > 0 else None
        self.ocr_workers = max(1, int(os.getenv("TEMPERATURE_OCR_WORKERS", "1")))
        
        # Auto-détection de la résolution de base si non fournie
        if self.roi_base_width == 0 or self.roi_base_height == 0:
            self._auto_detect_base_resolution()

    def _auto_detect_base_resolution(self):
        """Détermine la résolution de référence des ROIs à partir du fichier config."""
        max_x = 0
        max_y = 0
        if not self.roi_config:
            return
            
        for station, rois in self.roi_config.items():
            for key in ("tmin_roi", "tmax_roi", "icon_roi"):
                roi = rois.get(key)
                if roi and len(roi) >= 4:
                    max_x = max(max_x, roi[2])
                    max_y = max(max_y, roi[3])
        
        # On définit une résolution de base légèrement supérieure au max trouvé
        if max_x > 0 and self.roi_base_width == 0:
            self.roi_base_width = max_x + 5
            logger.info(f"Auto-détection ROI_BASE_WIDTH: {self.roi_base_width}")
            
        if max_y > 0 and self.roi_base_height == 0:
            self.roi_base_height = max_y + 5
            logger.info(f"Auto-détection ROI_BASE_HEIGHT: {self.roi_base_height}")

    def _build_roi_lookup(self):
        if not self.roi_config:
            return []
        entries = []
        for station, rois in self.roi_config.items():
            for key in ("tmin_roi", "tmax_roi"):
                roi = rois.get(key)
                if not roi:
                    continue
                x1, y1, x2, y2 = [int(v) for v in roi]
                entries.append(
                    {
                        "station": station,
                        "bbox": (x1, y1, x2, y2),
                    }
                )
        return entries

    def _load_roi_config(self, roi_config_path):
        if not roi_config_path:
            return {}
        path = Path(roi_config_path)
        if not path.exists():
            return {}
        try:
            with open(path, "r", encoding="utf-8") as handle:
                return json.load(handle)
        except Exception:
            return {}

    def preprocess_image_for_ocr(self, image_path, bbox=None):
        """Historique : conserve le pretraitement standard pour compatibilite."""
        return self._preprocess_standard(image_path, bbox)

    def _preprocess_standard(self, image_path, bbox=None):
        """Prepare une image (ou un crop) pour maximiser la qualite OCR (methode historique)."""
        image = cv2.imread(str(Path(image_path)))
        if image is None:
            raise FileNotFoundError(f"Impossible de lire l'image : {image_path}")

        if bbox is not None:
            x, y, w, h = bbox
            image = image[y : y + h, x : x + w]

        if self.ocr_upscale and self.ocr_upscale != 1.0:
            image = cv2.resize(
                image,
                None,
                fx=self.ocr_upscale,
                fy=self.ocr_upscale,
                interpolation=cv2.INTER_LINEAR,
            )
        gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
        gray = cv2.GaussianBlur(gray, (3, 3), 0)
        _, thresh = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
        return thresh

    def _preprocess_sharp_contrast(self, image_path, bbox=None):
        """Variation forte (CLAHE + sharpen) identifiee comme performante via le benchmark."""
        image = cv2.imread(str(Path(image_path)))
        if image is None:
            raise FileNotFoundError(f"Impossible de lire l'image : {image_path}")

        if bbox is not None:
            x, y, w, h = bbox
            image = image[y : y + h, x : x + w]

        if self.ocr_upscale and self.ocr_upscale != 1.0:
            image = cv2.resize(
                image,
                None,
                fx=self.ocr_upscale,
                fy=self.ocr_upscale,
                interpolation=cv2.INTER_LINEAR,
            )
        lab = cv2.cvtColor(image, cv2.COLOR_BGR2LAB)
        l, a, b = cv2.split(lab)
        clahe = cv2.createCLAHE(clipLimit=4.0, tileGridSize=(4, 4))
        l_enhanced = clahe.apply(l)
        enhanced_lab = cv2.merge([l_enhanced, a, b])
        enhanced_bgr = cv2.cvtColor(enhanced_lab, cv2.COLOR_LAB2BGR)

        gray = cv2.cvtColor(enhanced_bgr, cv2.COLOR_BGR2GRAY)
        kernel_sharpen = np.array(
            [
                [-1, -1, -1],
                [-1, 9, -1],
                [-1, -1, -1],
            ],
            dtype=np.float32,
        )
        sharpened = cv2.filter2D(gray, -1, kernel_sharpen)
        _, binary = cv2.threshold(sharpened, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
        inverted = cv2.bitwise_not(binary)
        return inverted

    def _preprocess_color_mask(self, image_path, bbox=None):
        """Isolation intelligente des couleurs (Rouge/Bleu/Noir) pour OCR."""
        image = cv2.imread(str(Path(image_path)))
        if image is None:
            raise FileNotFoundError(f"Impossible de lire l'image : {image_path}")

        if bbox is not None:
            x, y, w, h = bbox
            image = image[y : y + h, x : x + w]

        # Passage en HSV pour mieux isoler les teintes
        hsv = cv2.cvtColor(image, cv2.COLOR_BGR2HSV)
        
        # Masques plus permissifs pour capturer les chiffres même clairs
        # Rouge (Tmax) - couvre les deux plages du rouge en HSV
        red_low = cv2.inRange(hsv, (0, 40, 40), (15, 255, 255))
        red_high = cv2.inRange(hsv, (165, 40, 40), (180, 255, 255))
        # Bleu (Tmin)
        blue = cv2.inRange(hsv, (100, 40, 40), (140, 255, 255))
        # Noir/Gris foncé (Slash et texte)
        black = cv2.inRange(hsv, (0, 0, 0), (180, 255, 70))
        
        # Fusion des masques
        mask = cv2.bitwise_or(red_low, red_high)
        mask = cv2.bitwise_or(mask, blue)
        mask = cv2.bitwise_or(mask, black)
        
        # Création d'une image binaire : texte noir sur fond blanc
        enhanced = np.ones_like(image[:,:,0]) * 255
        enhanced[mask > 0] = 0
        
        # Upscale x3 pour une meilleure reconnaissance des petits chiffres
        enhanced = cv2.resize(
            enhanced,
            None,
            fx=3.0,
            fy=3.0,
            interpolation=cv2.INTER_CUBIC
        )
        
        return enhanced

    def extract_temperature_values(self, image_path, map_bbox=None):
        """Detecte tous les motifs '24/31' dans une carte donnee."""
        results = []
        station_names_found = set()

        # 1. Extraction via ROI (Prioritaire)
        if self.roi_config:
            roi_results = self._extract_temperatures_from_rois(image_path)
            for res in roi_results:
                results.append(res)
                if res.get("name"):
                    station_names_found.add(res["name"])

        # 2. Extraction via OCR Global (Complémentaire)
        roi_lookup = None
        # ... (le reste du code existant pour préparer l'OCR)
        if self.roi_config and self.roi_base_width > 0 and self.roi_base_height > 0:
            image = cv2.imread(str(Path(image_path)))
            if image is not None:
                roi_lookup = self._get_scaled_roi_lookup(image.shape)

        processed_variants = [
            ("standard", self._preprocess_standard(image_path, map_bbox)),
            ("sharp_contrast", self._preprocess_sharp_contrast(image_path, map_bbox)),
            ("color_mask", self._preprocess_color_mask(image_path, map_bbox)),
        ]

        ocr_config = "--psm 6 -c tessedit_char_whitelist=0123456789/NPnp "
        best_variant = None
        best_score = (-1, -1.0)
        for name, processed_image in processed_variants:
            try:
                ocr_data = pytesseract.image_to_data(
                    processed_image,
                    output_type=Output.DICT,
                    config=ocr_config,
                    timeout=self.ocr_timeout,
                )
            except RuntimeError as exc:
                logger.warning("OCR image_to_data timeout pour %s: %s", image_path, exc)
                continue
            detections = self.parse_temperature_data(ocr_data, map_bbox, image_shape=processed_image.shape)
            if self.roi_config:
                detections = self._assign_station_names(detections, roi_lookup=roi_lookup)
            score = self._score_detections(detections)
            if score > best_score:
                best_score = score
                best_variant = (name, detections)
            if self.verbose:
                logger.warning(
                    "OCR variant %s -> %s detections (avg_conf=%.2f)",
                    name,
                    score[0],
                    score[1],
                )
        if best_variant:
            name, variant_detections = best_variant
            for det in variant_detections:
                # Éviter les doublons si la station est déjà trouvée via ROI
                if det.get("name") and det["name"] in station_names_found:
                    continue
                results.append(det)
                if det.get("name"):
                    station_names_found.add(det["name"])
                    
            if self.verbose:
                logger.warning(
                    "OCR variant %s -> %s unique detections added (total=%s)",
                    name,
                    len(results) - (len(roi_results) if self.roi_config else 0),
                    len(results),
                )
        return results

    def _assign_station_names(self, detections, roi_lookup=None):
        lookup = roi_lookup if roi_lookup is not None else self._roi_lookup
        if not lookup:
            return detections
        updated = []
        for entry in detections:
            if entry.get("name"):
                updated.append(entry)
                continue
            station = self._resolve_station_from_bbox(entry.get("bbox"), lookup)
            if station:
                entry["name"] = station
                updated.append(entry)
            elif not self.drop_unmapped:
                updated.append(entry)
        return updated

    def _resolve_station_from_bbox(self, bbox, lookup):
        if not bbox:
            return None
        x, y, w, h = bbox
        cx = x + w / 2
        cy = y + h / 2
        tolerance = self.roi_match_tolerance
        for entry in lookup:
            x1, y1, x2, y2 = entry["bbox"]
            if (x1 - tolerance) <= cx <= (x2 + tolerance) and (y1 - tolerance) <= cy <= (
                y2 + tolerance
            ):
                return entry["station"]
        return None

    def parse_temperature_data(self, ocr_data, bbox, image_shape=None):
        """Convertit la sortie brute de Tesseract en couples Tmin/Tmax."""
        h_img, w_img = image_shape[:2] if image_shape else (None, None)
        pattern = re.compile(r"^(\d{1,2}|np)\s*/\s*(\d{1,2}|np)$", re.IGNORECASE)
        temperatures = []

        def _parse_tokens(raw_text: str):
            if not raw_text:
                return None, None, None, None
            cleaned = raw_text.strip()
            cleaned = cleaned.replace("°", "").replace("º", "")
            cleaned = cleaned.replace("\\", "/").replace("|", "/")
            cleaned = re.sub(r"[=:+]+", "/", cleaned)
            lowered = cleaned.lower()

            match = pattern.match(cleaned)
            if match:
                return match.group(1), match.group(2), cleaned, lowered

            # Fallback: accept separators like "-" or whitespace.
            if re.search(r"[/\\-\\s]", cleaned):
                tokens = re.findall(r"(?:np|\\d{1,2})", lowered)
                if len(tokens) >= 2:
                    return tokens[0], tokens[1], cleaned, lowered

            return None, None, cleaned, lowered

        for i, text in enumerate(ocr_data.get("text", [])):
            text = text.strip()
            if not text:
                continue

            raw_tmin, raw_tmax, cleaned_text, lowered_text = _parse_tokens(text)
            if raw_tmin is None or raw_tmax is None:
                continue
            tmin = self._value_from_token(raw_tmin)
            tmax = self._value_from_token(raw_tmax)

            if tmin is not None and not (5 <= tmin <= 35):
                continue
            if tmax is not None and not (10 <= tmax <= 50):
                continue
            if tmin is not None and tmax is not None and tmin > tmax:
                continue

            left = int(ocr_data["left"][i])
            top = int(ocr_data["top"][i])
            width = int(ocr_data["width"][i])
            height = int(ocr_data["height"][i])
            scale = self.ocr_upscale if self.ocr_upscale else 1.0
            if scale and scale != 1.0:
                left = int(left / scale)
                top = int(top / scale)
                width = int(width / scale)
                height = int(height / scale)
            if bbox is not None:
                try:
                    offset_x, offset_y = int(bbox[0]), int(bbox[1])
                except (TypeError, ValueError):
                    offset_x, offset_y = 0, 0
                left += offset_x
                top += offset_y
            relative_bbox = (
                int(ocr_data["left"][i] / scale) if scale and scale != 1.0 else int(ocr_data["left"][i]),
                int(ocr_data["top"][i] / scale) if scale and scale != 1.0 else int(ocr_data["top"][i]),
                width,
                height
            )
            temp_bbox = (left, top, width, height)
            conf = None
            if "conf" in ocr_data:
                try:
                    conf_val = float(ocr_data["conf"][i])
                    conf = conf_val if conf_val >= 0 else None
                except (TypeError, ValueError):
                    conf = None

            temperatures.append(
                {
                    "bbox": temp_bbox,
                    "relative_bbox": relative_bbox,
                    "map_bbox": bbox,
                    "tmin": tmin,
                    "tmax": tmax,
                    "tmin_raw": self._normalize_temp_raw(tmin, raw_tmin),
                    "tmax_raw": self._normalize_temp_raw(tmax, raw_tmax),
                    "raw_text": cleaned_text or text,
                    "confidence": conf,
                    "name": None,
                    "map_width": w_img,
                    "map_height": h_img
                }
            )

        return temperatures

    def _score_detections(self, detections):
        if not detections:
            return (0, 0.0)
        confidences = [
            entry.get("confidence")
            for entry in detections
            if isinstance(entry.get("confidence"), (int, float))
        ]
        avg_conf = float(sum(confidences) / len(confidences)) if confidences else 0.0
        return (len(detections), avg_conf)

    def extract_temperatures(self, pdf_results):
        """Applique l'extraction a chaque carte referencee par le PDF extractor."""
        def _process_pdf(pdf_result):
            pdf_temps_data = {
                "pdf_path": pdf_result["pdf_path"],
                "image_path": pdf_result.get("image_path"),
                "data": [],
            }

            for map_data in pdf_result.get("maps", []):
                map_image_path = map_data.get("image_path") or pdf_result["image_path"]
                map_bbox = map_data.get("bbox")
                if map_image_path != pdf_result.get("image_path"):
                    map_bbox = None

                temps = self.extract_temperature_values(
                    map_image_path,
                    map_bbox,
                )
                pdf_temps_data["data"].append(
                    {
                        "type": map_data["type"],
                        "image_path": map_image_path,
                        "temperatures": temps,
                    }
                )

            return pdf_temps_data

        if self.ocr_workers <= 1 or len(pdf_results) <= 1:
            return [_process_pdf(pdf) for pdf in pdf_results]

        with ThreadPoolExecutor(max_workers=min(self.ocr_workers, len(pdf_results))) as executor:
            return list(executor.map(_process_pdf, pdf_results))

    def _log_verbose(self, message: str) -> None:
        if self.verbose:
            logger.warning(message)

    def _get_scaled_roi_lookup(self, image_shape):
        height, width = image_shape[:2]
        if not (self.roi_base_width > 0 and self.roi_base_height > 0):
            return self._roi_lookup
        scale_x = width / float(self.roi_base_width)
        scale_y = height / float(self.roi_base_height)
        if abs(scale_x - 1.0) < 1e-3 and abs(scale_y - 1.0) < 1e-3:
            return self._roi_lookup
        scaled = []
        for entry in self._roi_lookup:
            x1, y1, x2, y2 = entry["bbox"]
            scaled.append(
                {
                    "station": entry["station"],
                    "bbox": (
                        int(round(x1 * scale_x)),
                        int(round(y1 * scale_y)),
                        int(round(x2 * scale_x)),
                        int(round(y2 * scale_y)),
                    ),
                }
            )
        return scaled

    def _scale_roi(self, roi, scale_x, scale_y):
        if not roi:
            return None
        x1, y1, x2, y2 = [int(v) for v in roi]
        
        # Ajout d'un padding de sécurité pour éviter de tronquer les chiffres larges
        # +5 pixels de chaque côté
        pad = 5
        
        return [
            max(0, int(round(x1 * scale_x)) - pad),
            max(0, int(round(y1 * scale_y)) - pad),
            int(round(x2 * scale_x)) + pad,
            int(round(y2 * scale_y)) + pad,
        ]

    def _extract_temperatures_from_rois(self, image_path):
        image = cv2.imread(str(image_path))
        if image is None:
            return []
        
        height, width = image.shape[:2]

        scale_x = 1.0
        scale_y = 1.0
        if self.roi_base_width > 0 and self.roi_base_height > 0:
            scale_x = width / float(self.roi_base_width)
            scale_y = height / float(self.roi_base_height)

        results = []
        for station, rois in self.roi_config.items():
            tmin_roi = rois.get("tmin_roi")
            tmax_roi = rois.get("tmax_roi")
            if scale_x != 1.0 or scale_y != 1.0:
                tmin_roi = self._scale_roi(tmin_roi, scale_x, scale_y)
                tmax_roi = self._scale_roi(tmax_roi, scale_x, scale_y)
            if not tmin_roi and not tmax_roi:
                continue

            tmin, tmin_raw = self._ocr_single_value(image, tmin_roi)
            tmax, tmax_raw = self._ocr_single_value(image, tmax_roi)
            if tmin is None and tmax is None and not (tmin_raw or tmax_raw):
                continue

            bbox = self._roi_to_bbox(tmin_roi or tmax_roi)
            tmin_raw = self._normalize_temp_raw(tmin, tmin_raw)
            tmax_raw = self._normalize_temp_raw(tmax, tmax_raw)
            results.append(
                {
                    "name": station,
                    "bbox": bbox,
                    "map_bbox": None,
                    "tmin": tmin,
                    "tmax": tmax,
                    "tmin_raw": tmin_raw,
                    "tmax_raw": tmax_raw,
                    "raw_text": None,
                    "map_width": width,
                    "map_height": height
                }
            )

        return results

    def _ocr_single_value(self, image, roi, is_retry=False):
        if not roi:
            return (None, None)
            
        x1, y1, x2, y2 = [int(v) for v in roi]
        
        # Si c'est un second essai, on élargit plus généreusement (+15px)
        if is_retry:
            pad = 15
            x1 = max(0, x1 - pad)
            y1 = max(0, y1 - pad)
            x2 = min(image.shape[1], x2 + pad)
            y2 = min(image.shape[0], y2 + pad)

        crop = image[y1:y2, x1:x2]
        if crop.size == 0:
            return (None, None)

        # Retour à la méthode Niveau de Gris + Otsu (plus robuste selon vos tests)
        gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)
        
        # Upscale x3 pour une meilleure lecture par Tesseract
        scaled = cv2.resize(gray, None, fx=3.0, fy=3.0, interpolation=cv2.INTER_CUBIC)
        
        # Seuil binaire automatique (Otsu)
        _, thresh = cv2.threshold(scaled, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
        
        try:
            text = pytesseract.image_to_string(
                thresh,
                config="--psm 7 -c tessedit_char_whitelist=0123456789NPnp",
                timeout=self.ocr_timeout,
            )
        except RuntimeError as exc:
            logger.warning("OCR image_to_string timeout sur ROI %s: %s", roi, exc)
            return (None, None)
            
        clean = text.strip()
        if not clean:
            if not is_retry:
                return self._ocr_single_value(image, roi, is_retry=True)
            return (None, None)
            
        digits = re.findall(r"\d{1,2}", clean)
        if digits:
            val_str = digits[0]
            value = int(val_str)
            
            # Si un seul chiffre est trouvé, on tente l'agrandissement de zone
            if len(val_str) == 1 and not is_retry:
                retry_val, retry_raw = self._ocr_single_value(image, roi, is_retry=True)
                if retry_val is not None and retry_val > 9:
                    return (retry_val, retry_raw)
            
            if 0 <= value <= 60:
                return (value, self._normalize_temp_raw(value, clean))
                
        if clean.upper().startswith("NP"):
            return (None, "NP")
        return (None, None)

    def _roi_to_bbox(self, roi):
        if not roi:
            return None
        x1, y1, x2, y2 = [int(v) for v in roi]
        return (x1, y1, x2 - x1, y2 - y1)

    def _value_from_token(self, token):
        token = token.upper()
        if token == "NP":
            return None
        try:
            return int(token)
        except ValueError:
            return None

    @staticmethod
    def _normalize_temp_raw(value, raw_token):
        if value is None:
            return "NP"
        try:
            return f"{int(value):02d}"
        except (TypeError, ValueError):
            return "NP"
