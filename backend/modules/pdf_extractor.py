import os
import re
from pathlib import Path

import io
import numpy as np
import requests
from concurrent.futures import ThreadPoolExecutor
from tqdm import tqdm
import fitz
from PIL import Image

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

        self.pdf_image_cache = os.getenv("PDF_IMAGE_CACHE", "1").lower() in {"1", "true", "yes"}
        self.pdf_image_directory = self.temp_directory / "pdf_images"
        self.pdf_image_directory.mkdir(exist_ok=True)

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

        return results


    def _crop_contains_content(self, image):
        """Ecarte les decoupes vides ou quasiment blanches (cas des bulletins 18h)."""
        gray = np.array(image.convert("L"))
        non_white_ratio = np.count_nonzero(gray < 240) / gray.size
        return non_white_ratio >= self.min_content_ratio

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
