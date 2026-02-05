#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""Classification des icones meteo issues des cartes ANAM."""

import json
import os
from pathlib import Path

import cv2
import numpy as np


class IconClassifier:
    """Classifie les icônes météo via templates/ROI et heuristiques locales."""

    def __init__(
        self,
        roi_config_path=None,
        template_directory=None,
    ):
        self.weather_conditions = {
            "ensoleille": "ensoleillé",
            "soleil": "ensoleillé",
            "sunny": "ensoleillé",
            "ciel_degage": "ensoleillé",
            "nuageux": "nuageux",
            "cloudy": "nuageux",
            "ciel_nuageux": "nuageux",
            "ciel_couvert": "nuageux",
            "pluie": "pluie",
            "rain": "pluie",
            "averse": "pluie",
            "orage": "orage",
            "storm": "orage",
            "orages": "orage",
            "pluies_orageuses": "orage",
            "pluies_orageuses_isolees": "orage",
            "partiellement_nuageux": "partiellement nuageux",
            "partly_cloudy": "partiellement nuageux",
            "temps_partiellement__nuageux": "partiellement nuageux",
            "poussiere": "poussière",
            "poussiere_en_suspension": "poussière",
        }
        self.canonical_conditions = {
            "ensoleillé",
            "nuageux",
            "pluie",
            "orage",
            "partiellement nuageux",
            "poussière",
        }
        self.template_threshold = 0.6
        self.roi_config = self._load_roi_config(roi_config_path)
        self.template_directory = (
            Path(template_directory)
            if template_directory
            else Path(__file__).parent.parent / "resources" / "templates" / "icons"
        )
        self.icon_templates = self._load_icon_templates(self.template_directory)

    # ------------------------------------------------------------------ #
    # Chargement des ressources
    # ------------------------------------------------------------------ #
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

    def _load_icon_templates(self, template_directory):
        """Charge les templates avec augmentation."""
        templates = {}
        if not template_directory.exists():
            return templates

        for template_file in template_directory.glob("*.*"):
            condition = self._normalize_condition(template_file.stem)
            if not condition:
                continue
            
            image = cv2.imread(str(template_file), cv2.IMREAD_GRAYSCALE)
            if image is None or image.size == 0:
                continue
            
            base_template = cv2.resize(image, (48, 48), interpolation=cv2.INTER_AREA)
            
            # Ajout du template original
            templates.setdefault(condition, []).append(base_template)
            
            # Augmentation : rotations légères
            for angle in [-5, 5]:
                M = cv2.getRotationMatrix2D((24, 24), angle, 1.0)
                rotated = cv2.warpAffine(base_template, M, (48, 48))
                templates[condition].append(rotated)
            
            # Augmentation : variations de luminosité
            for gamma in [0.8, 1.2]:
                adjusted = self._adjust_gamma(base_template, gamma)
                templates[condition].append(adjusted)

        if templates:
            total = sum(len(images) for images in templates.values())
            print(f"{total} modèles d'icônes chargés depuis {template_directory}.")
        return templates

    def _adjust_gamma(self, image, gamma=1.0):
        """Ajuste la luminosité avec correction gamma."""
        inv_gamma = 1.0 / gamma
        table = np.array([((i / 255.0) ** inv_gamma) * 255 
                        for i in range(256)]).astype("uint8")
        return cv2.LUT(image, table)

    def _normalize_condition(self, raw_label):
        if not raw_label:
            return None
        label = raw_label.lower()
        canonical = self.weather_conditions.get(label)
        if canonical in self.canonical_conditions:
            return canonical
        if label in self.canonical_conditions:
            return label
        return None

    # ------------------------------------------------------------------ #
    # Détection locale
    # ------------------------------------------------------------------ #
    def preprocess_icon_region(self, image_path, enhance=True):
        """Charge et prétraite l'image avec amélioration optionnelle."""
        image = cv2.imread(str(image_path))
        if image is None:
            raise ValueError(f"Could not load image: {image_path}")
        
        gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
        
        if enhance:
            # Égalisation d'histogramme adaptative (CLAHE)
            clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
            gray = clahe.apply(gray)
            
            # Réduction du bruit
            gray = cv2.fastNlMeansDenoising(gray, h=10)
        
        return gray

    def _compare_with_templates(self, crop_gray):
        """Compare avec plusieurs métriques pour plus de robustesse."""
        if not self.icon_templates:
            return (None, 0.0)

        resized_crop = cv2.resize(crop_gray, (48, 48), interpolation=cv2.INTER_AREA)
        norm_crop = cv2.normalize(resized_crop.astype("float32"), None, 0.0, 1.0, cv2.NORM_MINMAX)

        best_condition = None
        best_score = 0.0
    
        for condition, templates in self.icon_templates.items():
            for template in templates:
                template_norm = cv2.normalize(
                    template.astype("float32"), None, 0.0, 1.0, cv2.NORM_MINMAX
                )
                
                # Combinaison de plusieurs métriques
                l2_score = 1.0 - cv2.norm(norm_crop, template_norm, cv2.NORM_L2)
                
                # Corrélation normalisée
                corr = cv2.matchTemplate(norm_crop, template_norm, cv2.TM_CCORR_NORMED)[0, 0]
                
                # Score SSIM (Structural Similarity)
                ssim_score = self._compute_ssim(norm_crop, template_norm)
                
                # Score pondéré
                combined_score = (l2_score * 0.3 + corr * 0.4 + ssim_score * 0.3)
                
                if combined_score > best_score:
                    best_score = float(combined_score)
                    best_condition = condition

        if best_score < self.template_threshold:
            return (None, best_score)
        return (best_condition, best_score)

    def _compute_ssim(self, img1, img2):
        """Calcule le SSIM entre deux images."""
        C1 = 0.01 ** 2
        C2 = 0.03 ** 2
        
        mu1 = cv2.GaussianBlur(img1, (11, 11), 1.5)
        mu2 = cv2.GaussianBlur(img2, (11, 11), 1.5)
        
        mu1_sq = mu1 ** 2
        mu2_sq = mu2 ** 2
        mu1_mu2 = mu1 * mu2
        
        sigma1_sq = cv2.GaussianBlur(img1 ** 2, (11, 11), 1.5) - mu1_sq
        sigma2_sq = cv2.GaussianBlur(img2 ** 2, (11, 11), 1.5) - mu2_sq
        sigma12 = cv2.GaussianBlur(img1 * img2, (11, 11), 1.5) - mu1_mu2
        
        ssim = ((2 * mu1_mu2 + C1) * (2 * sigma12 + C2)) / \
            ((mu1_sq + mu2_sq + C1) * (sigma1_sq + sigma2_sq + C2))
        
        return float(np.mean(ssim))

    def classify_icon_simple(self, icon_image):
        """Classification avec features plus riches."""
        resized = cv2.resize(icon_image, (48, 48), interpolation=cv2.INTER_AREA)
        
        # Features existantes
        mean_intensity = float(np.mean(resized))
        std_intensity = float(np.std(resized))
        bright_ratio = float(np.mean(resized > 210))
        dark_ratio = float(np.mean(resized < 80))
        
        # Features supplémentaires
        edges = cv2.Canny(resized, 80, 160)
        edge_ratio = float(np.mean(edges > 0))
        
        # Analyse des contours
        contours, _ = cv2.findContours(edges, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        num_contours = len(contours)
        
        # Moments de Hu (invariants géométriques)
        moments = cv2.moments(resized)
        hu_moments = cv2.HuMoments(moments).flatten()
        
        # Histogramme
        hist = cv2.calcHist([resized], [0], None, [16], [0, 256])
        hist = hist.flatten() / hist.sum()
        hist_entropy = -np.sum(hist * np.log2(hist + 1e-10))
        
        # Texture (LBP simplifié)
        texture_score = self._compute_texture_score(resized)
        
        # Règles de classification améliorées
        if bright_ratio > 0.35 and std_intensity < 45 and num_contours < 5:
            return ("ensoleillé", 0.65)
        
        if bright_ratio > 0.25 and edge_ratio > 0.25 and hist_entropy > 2.5:
            return ("partiellement nuageux", 0.60)
        
        if dark_ratio > 0.35 and edge_ratio > 0.20 and texture_score > 0.3:
            return ("pluie", 0.55)
        
        if dark_ratio > 0.30 and edge_ratio > 0.35 and num_contours > 8:
            return ("orage", 0.55)
        
        if std_intensity < 25 and hist_entropy < 2.0:
            return ("nuageux", 0.50)
        
        if mean_intensity > 180 and std_intensity > 40 and texture_score < 0.2:
            return ("poussière", 0.45)
        
        return ("inconnu", 0.2)

    def _compute_texture_score(self, image):
        """Calcule un score de texture basé sur LBP."""
        # LBP simplifié 3x3
        h, w = image.shape
        lbp = np.zeros_like(image)
        
        for i in range(1, h-1):
            for j in range(1, w-1):
                center = image[i, j]
                code = 0
                code |= (image[i-1, j-1] >= center) << 7
                code |= (image[i-1, j] >= center) << 6
                code |= (image[i-1, j+1] >= center) << 5
                code |= (image[i, j+1] >= center) << 4
                code |= (image[i+1, j+1] >= center) << 3
                code |= (image[i+1, j] >= center) << 2
                code |= (image[i+1, j-1] >= center) << 1
                code |= (image[i, j-1] >= center) << 0
                lbp[i, j] = code
        
        # Variance du LBP comme indicateur de texture
        return float(np.std(lbp) / 255.0)

    def _classify_roi_crop(self, crop_gray):
        """Essaye les modèles (templates) puis l'heuristique sur un extrait en niveaux de gris."""
        template_condition, template_score = self._compare_with_templates(crop_gray)
        if template_condition:
            return template_condition, template_score
        return self.classify_icon_simple(crop_gray)

    def _fallback_classification(self, image_path):
        """Plan de secours heuristique lorsque les modèles sont indisponibles."""
        try:
            icon_image = self.preprocess_icon_region(image_path)
            condition, confidence = self.classify_icon_simple(icon_image)
            return [
                {
                    "bbox": (0, 0, icon_image.shape[1], icon_image.shape[0]),
                    "weather_condition": condition,
                    "confidence": confidence,
                    "raw_label": "heuristique",
                }
            ]
        except Exception as exc:
            print(f"Erreur classification icone (fallback) : {exc}")
            return []

    # ------------------------------------------------------------------ #
    # Classification principale
    # ------------------------------------------------------------------ #
    def classify_icons_in_map(self, image_path):
        """Detecte et classe les icones presentes sur une carte donnee (Local ROI / Templates uniquement)."""
        roi_icons = self._classify_icons_from_rois(image_path)
        if roi_icons:
            return roi_icons

        # Si pas de ROI, on essaye les templates puis l'heuristique
        icons = []
        icons.extend(self._detect_icons_with_templates(image_path))
        if not icons:
            icons.extend(self._fallback_classification(image_path))

        return icons

    def classify_icons(self, pdf_results):
        """Applique la detection carte par carte sur l'ensemble des PDF traites."""
        all_icons = []

        for pdf_result in pdf_results:
            pdf_icons_data = {
                "pdf_path": pdf_result["pdf_path"],
                "data": [],
            }

            for map_data in pdf_result["maps"]:
                map_type = map_data["type"]
                map_image_path = map_data.get("image_path", pdf_result["image_path"])

                icons = self.classify_icons_in_map(map_image_path)

                pdf_icons_data["data"].append(
                    {
                        "type": map_type,
                        "icons": icons,
                    }
                )

            all_icons.append(pdf_icons_data)

        return all_icons
    # ------------------------------------------------------------------ #
    # Détection basée sur les ROI / modèles
    # ------------------------------------------------------------------ #
    def _classify_icons_from_rois(self, image_path):
        """Utilise les ROI renseignées pour produire une prédiction par station."""
        if not self.roi_config:
            return []

        image = cv2.imread(str(image_path))
        if image is None:
            return []

        icons = []
        for station, rois in self.roi_config.items():
            icon_roi = rois.get("icon_roi")
            if not icon_roi:
                continue
            x1, y1, x2, y2 = [int(v) for v in icon_roi]
            crop = image[y1:y2, x1:x2]
            if crop.size == 0:
                continue
            gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)
            weather_condition, confidence = self._classify_roi_crop(gray)

            icons.append(
                {
                    "name": station,
                    "bbox": (x1, y1, x2 - x1, y2 - y1),
                    "weather_condition": weather_condition,
                    "confidence": round(float(confidence), 3),
                    "raw_label": weather_condition,
                }
            )
        return icons


    @staticmethod
    def _crop_bbox(image, bbox):
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

    def _detect_icons_with_templates(self, image_path):
        """Template matching multi-échelle."""
        if not self.icon_templates:
            return []

        base_image = cv2.imread(str(image_path), cv2.IMREAD_GRAYSCALE)
        if base_image is None:
            return []

        detections = []
        scales = [0.8, 1.0, 1.2, 1.5]  # Différentes échelles
        
        for scale in scales:
            if scale != 1.0:
                scaled_image = cv2.resize(
                    base_image, 
                    None, 
                    fx=scale, 
                    fy=scale, 
                    interpolation=cv2.INTER_AREA
                )
            else:
                scaled_image = base_image
            
            h_base, w_base = scaled_image.shape[:2]

            for condition, templates in self.icon_templates.items():
                for template in templates:
                    th, tw = template.shape[:2]
                    if h_base < th or w_base < tw:
                        continue
                    
                    result = cv2.matchTemplate(scaled_image, template, cv2.TM_CCOEFF_NORMED)
                    locations = np.where(result >= self.template_threshold)
                    
                    for pt in zip(*locations[::-1]):
                        # Ajuster les coordonnées selon l'échelle
                        x = int(pt[0] / scale)
                        y = int(pt[1] / scale)
                        w = int(tw / scale)
                        h = int(th / scale)
                        
                        detections.append({
                            "bbox": (x, y, w, h),
                            "weather_condition": condition,
                            "confidence": float(result[pt[1], pt[0]]),
                            "raw_label": "template",
                            "scale": scale
                        })

        return self._non_max_suppression(detections, overlap_threshold=0.4)

    def _non_max_suppression(self, detections, overlap_threshold=0.3):
        """Filtre les détections superposées pour éviter les doublons."""
        if not detections:
            return []

        boxes = np.array([det["bbox"] for det in detections], dtype=float)
        confidences = np.array([det["confidence"] for det in detections])
        x1 = boxes[:, 0]
        y1 = boxes[:, 1]
        x2 = boxes[:, 0] + boxes[:, 2]
        y2 = boxes[:, 1] + boxes[:, 3]

        areas = (x2 - x1) * (y2 - y1)
        order = confidences.argsort()[::-1]
        keep = []

        while order.size > 0:
            idx = order[0]
            keep.append(idx)
            xx1 = np.maximum(x1[idx], x1[order[1:]])
            yy1 = np.maximum(y1[idx], y1[order[1:]])
            xx2 = np.minimum(x2[idx], x2[order[1:]])
            yy2 = np.minimum(y2[idx], y2[order[1:]])

            w = np.maximum(0, xx2 - xx1)
            h = np.maximum(0, yy2 - yy1)
            intersection = w * h
            union = areas[idx] + areas[order[1:]] - intersection
            iou = np.zeros_like(intersection)
            valid_union = union > 0
            iou[valid_union] = intersection[valid_union] / union[valid_union]

            remaining = np.where(iou <= overlap_threshold)[0]
            order = order[remaining + 1]

        return [detections[i] for i in keep]

    def _validate_detection(self, image, bbox, weather_condition):
        """Valide une détection en vérifiant la cohérence."""
        crop = self._crop_bbox(image, bbox)
        if crop is None:
            return False
        
        # Vérifications de base
        if crop.shape[0] < 10 or crop.shape[1] < 10:
            return False
        
        gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)
        
        # Vérifier que ce n'est pas une zone uniforme
        if np.std(gray) < 5:
            return False
        
        # Vérifier le ratio largeur/hauteur (les icônes sont généralement carrées)
        aspect_ratio = crop.shape[1] / crop.shape[0]
        if aspect_ratio < 0.5 or aspect_ratio > 2.0:
            return False
        
        # Vérifier la cohérence avec la condition détectée
        heuristic_condition, _ = self.classify_icon_simple(gray)
        if heuristic_condition != weather_condition and heuristic_condition != "inconnu":
            # Si les deux méthodes donnent des résultats différents, réduire la confiance
            return False
        
        return True
