import os
import re
from pathlib import Path

import io
import json
import numpy as np
import requests
import time
from concurrent.futures import ThreadPoolExecutor, TimeoutError
from tqdm import tqdm
import fitz
from PIL import Image

try:
    from inference_sdk import InferenceHTTPClient
except ImportError:  # pragma: no cover
    InferenceHTTPClient = None

from backend.modules.workflow_utils import normalize_workflow_response

# Zones approximatives des cartes observation / prevision.
MAP_COORDINATES = {
    "observation": (800, 300, 850, 600),
    "forecast": (800, 1150, 850, 600),
}


class PDFExtractor:
    """Gere le téléchargement des PDFs puis la conversion en images."""

    def __init__(
        self,
        pdf_directory,
        output_directory,
        workflow_api_url=None,
        api_key=None,
        workspace=None,
        workflow_id=None,
    ):
        self.pdf_directory = Path(pdf_directory)
        self.output_directory = Path(output_directory)
        self.temp_directory = self.output_directory / "temp"
        self.temp_directory.mkdir(exist_ok=True)
        self.maps_directory = self.temp_directory / "maps"
        self.maps_directory.mkdir(exist_ok=True)
        self.min_content_ratio = 0.01
        self.min_map_width = int(os.getenv("PDF_MIN_MAP_WIDTH", "450"))
        self.min_map_height = int(os.getenv("PDF_MIN_MAP_HEIGHT", "320"))
        self.max_map_width = int(os.getenv("PDF_MAX_MAP_WIDTH", "1100"))
        self.max_map_height = int(os.getenv("PDF_MAX_MAP_HEIGHT", "900"))

        self.roboflow_api_key = api_key
        self.roboflow_workspace = workspace
        self.roboflow_workflow_id = workflow_id
        self.roboflow_api_url = workflow_api_url or "https://serverless.roboflow.com"
        self.enable_workflow_on_maps = os.getenv("ROBOFLOW_WORKFLOW_ON_MAPS", "1").lower() in {
            "1",
            "true",
            "yes",
        }
        self.workflow_use_cache = os.getenv("ROBOFLOW_WORKFLOW_USE_CACHE", "1").lower() in {
            "1",
            "true",
            "yes",
        }
        self.roboflow_timeout = float(os.getenv("ROBOFLOW_TIMEOUT_SECONDS", "30"))
        self.roboflow_retries = int(os.getenv("ROBOFLOW_RETRIES", "2"))
        self.roboflow_backoff = float(os.getenv("ROBOFLOW_BACKOFF_SECONDS", "1.0"))
        self.pdf_image_cache = os.getenv("PDF_IMAGE_CACHE", "1").lower() in {"1", "true", "yes"}
        self.workflow_client = None
        self._init_workflow_client()
        self.pdf_image_directory = self.temp_directory / "pdf_images"
        self.pdf_image_directory.mkdir(exist_ok=True)
        self.roboflow_predictions_directory = self.temp_directory / "roboflow_predictions"
        self.roboflow_predictions_directory.mkdir(exist_ok=True)

    def _init_workflow_client(self):
        """Initialise le client Roboflow si la configuration est fournie (DÉSACTIVÉ)."""
        self.workflow_client = None
        return

    def download_pdf(self, url, filename):
        """Telecharge un bulletin et le stocke dans le dossier configure."""
        target_path = self.pdf_directory / filename
        response = requests.get(url, timeout=30)
        response.raise_for_status()
        with open(target_path, "wb") as handle:
            handle.write(response.content)
        return target_path

    def _sanitize_filename(self, filename_stem):
        """Evite les caracteres exotiques dans les noms d'images intermediaires."""
        sanitized = re.sub(r"[^a-zA-Z0-9_-]", "_", filename_stem)
        return re.sub(r"__+", "_", sanitized)

    def process_single_pdf(self, pdf_path):
        """Cree la structure (image + cartes) utilisable par les modules suivants."""
        print(f"Traitement du PDF: {pdf_path.name}")

        sanitized_stem = self._sanitize_filename(pdf_path.stem)

        results = {
            "pdf_path": pdf_path,
            "image_path": None,
            "maps": [],
        }

        native_maps = self._extract_maps_from_pdf(pdf_path, sanitized_stem)
        if native_maps:
            results["maps"].extend(native_maps)

        if not results["maps"]:
            print("  !! Aucune carte detectee dans ce PDF.")
            return None

        # utilise la première carte comme image de référence par défaut
        results["image_path"] = results["maps"][0]["image_path"]
        self._run_workflow_on_maps(results["maps"], sanitized_stem)

        return results

    def _detect_maps_with_workflow(self, image_path, image_size, sanitized_stem):
        """Utilise le workflow Roboflow pour reperer les cartes observation/forecast."""
        if self.workflow_client is None:
            return []

        response = self._run_workflow_with_retry(
            images={"image": str(image_path)},
            context_label="detect_maps",
        )
        if response is None:
            return []
        normalized = normalize_workflow_response(response)
        self._save_roboflow_response(normalized, sanitized_stem)

        all_predictions = self._extract_predictions(normalized)
        carte_predictions = [pred for pred in all_predictions if pred.get("class") == "carte"]
        if not carte_predictions:
            return []

        width, height = image_size
        carte_predictions.sort(key=lambda pred: pred.get("y", 0))

        entity_classes = {"meteo", "temperature", "symbol", "ville"}
        entity_boxes = []
        for pred in all_predictions:
            if pred.get("class") not in entity_classes:
                continue
            bbox = self._prediction_to_bbox(pred, width, height)
            if not bbox:
                continue
            x, y, w, h = bbox
            entity_boxes.append(
                {
                    "bbox": bbox,
                    "center_x": x + w / 2,
                    "center_y": y + h / 2,
                }
            )

        detected_maps = []
        for pred in carte_predictions:
            bbox = self._prediction_to_bbox(pred, width, height)
            if not bbox:
                continue
            center_y = pred.get("y", 0)
            if len(carte_predictions) == 1:
                map_type = "observation"
            else:
                map_type = "observation" if center_y < height / 2 else "forecast"
            refined_bbox = self._refine_bbox_with_entities(bbox, entity_boxes, width, height)
            detected_maps.append({"type": map_type, "bbox": refined_bbox})

        return detected_maps

    def _run_workflow_on_maps(self, maps, sanitized_stem):
        """DÉSACTIVÉ - Ne lance plus de requêtes Roboflow."""
        return

    def _run_workflow_with_retry(self, images, context_label: str):
        def _call():
            return self.workflow_client.run_workflow(
                workspace_name=self.roboflow_workspace,
                workflow_id=self.roboflow_workflow_id,
                images=images,
                use_cache=self.workflow_use_cache,
            )

        for attempt in range(self.roboflow_retries + 1):
            try:
                with ThreadPoolExecutor(max_workers=1) as executor:
                    future = executor.submit(_call)
                    return future.result(timeout=self.roboflow_timeout)
            except TimeoutError:
                print(f"Timeout Roboflow ({context_label}).")
            except Exception as exc:
                print(f"Erreur Roboflow ({context_label}) : {exc}")
            if attempt < self.roboflow_retries:
                time.sleep(self.roboflow_backoff * (attempt + 1))
        return None

    def _refine_bbox_with_entities(self, map_bbox, entities, image_width, image_height):
        """Recentre la carte autour des entites detectees (icone, temperature...)."""
        if not entities:
            return map_bbox

        x_map, y_map, w_map, h_map = map_bbox
        x2_map = x_map + w_map
        y2_map = y_map + h_map

        relevant = [
            ent
            for ent in entities
            if x_map <= ent["center_x"] <= x2_map and y_map <= ent["center_y"] <= y2_map
        ]
        if len(relevant) < 2:
            return map_bbox

        min_x = min(ent["bbox"][0] for ent in relevant)
        min_y = min(ent["bbox"][1] for ent in relevant)
        max_x = max(ent["bbox"][0] + ent["bbox"][2] for ent in relevant)
        max_y = max(ent["bbox"][1] + ent["bbox"][3] for ent in relevant)

        padding = 40
        x1 = max(0, int(min_x) - padding)
        y1 = max(0, int(min_y) - padding)
        x2 = min(image_width, int(max_x) + padding)
        y2 = min(image_height, int(max_y) + padding)

        return (x1, y1, x2 - x1, y2 - y1)

    def _extract_predictions(self, response):
        """Parcourt la reponse workflow pour extraire la liste de predictions."""
        collected = []

        def _walk(node):
            if isinstance(node, dict):
                preds = node.get("predictions")
                if isinstance(preds, list):
                    collected.extend(preds)
                elif isinstance(preds, dict):
                    inner = preds.get("predictions")
                    if isinstance(inner, list):
                        collected.extend(inner)
                for value in node.values():
                    _walk(value)
            elif isinstance(node, list):
                for item in node:
                    _walk(item)

        _walk(response)
        return collected

    def _prediction_to_bbox(self, prediction, image_width, image_height):
        """Convertit une prediction Roboflow en bbox Pixel clampée à l'image."""
        try:
            width = float(prediction.get("width", 0))
            height = float(prediction.get("height", 0))
            center_x = float(prediction.get("x", 0))
            center_y = float(prediction.get("y", 0))
        except (TypeError, ValueError):
            return None

        if width <= 0 or height <= 0:
            return None

        padding = 10
        x1 = max(0, int(round(center_x - width / 2 - padding)))
        y1 = max(0, int(round(center_y - height / 2 - padding)))
        x2 = min(image_width, int(round(center_x + width / 2 + padding)))
        y2 = min(image_height, int(round(center_y + height / 2 + padding)))

        bbox_width = x2 - x1
        bbox_height = y2 - y1
        if bbox_width <= 0 or bbox_height <= 0:
            return None

        return (x1, y1, bbox_width, bbox_height)

    def _crop_contains_content(self, image):
        """Ecarte les decoupes vides ou quasiment blanches (cas des bulletins 18h)."""
        gray = np.array(image.convert("L"))
        non_white_ratio = np.count_nonzero(gray < 240) / gray.size
        return non_white_ratio >= self.min_content_ratio

    def _save_roboflow_response(self, response, sanitized_stem):
        """Sauvegarde la reponse brute du workflow pour inspection."""
        try:
            output_path = self.roboflow_predictions_directory / f"{sanitized_stem}_roboflow.json"
            with open(output_path, "w", encoding="utf-8") as handle:
                json.dump(response, handle, ensure_ascii=False, indent=2)
        except Exception as exc:  # pragma: no cover
            print(f"Impossible d'enregistrer le resultat Roboflow: {exc}")

    def _extract_maps_from_pdf(self, pdf_path, sanitized_stem):
        """Extrait directement les images du PDF pour observation/prevision."""
        maps = []
        type_counts = {"observation": 0, "forecast": 0}

        try:
            doc = fitz.open(pdf_path)
        except Exception:
            return maps

        try:
            for page_index, page in enumerate(doc, start=1):
                for img_index, img in enumerate(page.get_images(full=True), start=1):
                    xref = img[0]
                    try:
                        base_image = doc.extract_image(xref)
                    except Exception:
                        continue

                    width = base_image.get("width")
                    height = base_image.get("height")
                    if width is None or height is None:
                        continue
                    if width > self.max_map_width or height > self.max_map_height:
                        continue
                    if width < self.min_map_width or height < self.min_map_height:
                        continue

                    map_type = "observation" if len(maps) == 0 else "forecast"
                    type_counts[map_type] += 1
                    display_type = "observation" if map_type == "observation" else "prevision"

                    image_ext = "png"
                    map_image_name = (
                        f"{sanitized_stem}_{display_type}_{type_counts[map_type]}.{image_ext}"
                    )
                    map_image_path = self.pdf_image_directory / map_image_name
                    if not (self.pdf_image_cache and map_image_path.exists()):
                        try:
                            image = Image.open(io.BytesIO(base_image["image"])).convert("RGB")
                            image.save(map_image_path, format="PNG", optimize=True)
                        except Exception:
                            with open(map_image_path, "wb") as handle:
                                handle.write(base_image["image"])

                    maps.append(
                        {
                            "type": map_type,
                            "image_path": map_image_path,
                        }
                    )

                    if len(maps) >= 2:
                        return maps
        finally:
            doc.close()

        if len(maps) == 1:
            inferred = self._infer_single_map_type(pdf_path)
            if inferred and inferred in {"observation", "forecast"}:
                maps[0]["type"] = inferred

        return maps

    def _infer_single_map_type(self, pdf_path):
        """Devine le type d'une carte unique a partir du nom du PDF."""
        try:
            stem = Path(pdf_path).stem.lower()
        except Exception:
            stem = str(pdf_path).lower()

        if "prevision" in stem or "forecast" in stem:
            return "forecast"
        if "observation" in stem:
            return "observation"

        match = re.search(r"(?:^|[ _-])(\d{1,2})h", stem)
        if match:
            try:
                hour = int(match.group(1))
            except ValueError:
                hour = None
            threshold = int(os.getenv("SINGLE_MAP_FORECAST_HOUR", "18"))
            if hour is not None:
                return "forecast" if hour >= threshold else "observation"
        return None

    def download_and_process_pdfs(self):
        """Parcourt le dossier PDF et retourne les cartes predecoupees."""
        pdf_files = list(self.pdf_directory.glob("*.pdf"))

        workers = int(os.getenv("PDF_PROCESS_WORKERS", "2"))
        if workers <= 1 or len(pdf_files) <= 1:
            results = []
            for pdf_file in tqdm(pdf_files, desc="Traitement des PDFs"):
                try:
                    result = self.process_single_pdf(pdf_file)
                    if result:
                        results.append(result)
                except Exception as exc:
                    print(f"Erreur majeure lors du traitement de {pdf_file}: {exc}")
            return results

        results = []
        with ThreadPoolExecutor(max_workers=min(workers, len(pdf_files))) as executor:
            futures = {executor.submit(self.process_single_pdf, pdf): pdf for pdf in pdf_files}
            for future in tqdm(futures, desc="Traitement des PDFs"):
                pdf_file = futures[future]
                try:
                    result = future.result()
                    if result:
                        results.append(result)
                except Exception as exc:
                    print(f"Erreur majeure lors du traitement de {pdf_file}: {exc}")
        return results
