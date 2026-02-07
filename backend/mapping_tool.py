import argparse
import json
import os
import re
import sys
import unicodedata
from collections import defaultdict
from datetime import date
from pathlib import Path
from statistics import median

import cv2

SCRIPT_DIR = Path(__file__).resolve().parent
REPO_ROOT = SCRIPT_DIR.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from backend.modules.pdf_extractor import PDFExtractor

# --- CONFIGURATION ---
PDF_DIR = Path("backend/data/pdfs")
OUTPUT_JSON = Path("backend/config_roi.json")
DEFAULT_OUTPUT_DIR = Path("backend/data/mapping_tool_temp")

STATIONS = [
    "Ouagadougou", "Bobo-Dioulasso", "Dori",
    "Fada N'Gourma", "Ouahigouya", "D?dougou", "Boromo",
    "Gaoua", "P?", "Bogand?"
]

INFO_TYPE = {
    "tmin": {"label": "T-MIN (Temp Basse - Bleu)", "color": (255, 0, 0)},   # Bleu (BGR)
    "tmax": {"label": "T-MAX (Temp Haute - Rouge)", "color": (0, 0, 255)},  # Rouge (BGR)
    "icon": {"label": "ICONE (Le dessin)", "color": (0, 200, 0)}           # Vert (BGR)
}

MONTHS_MAP = {
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


def _normalize_text(value: str) -> str:
    text = value.lower().replace("_", " ").replace("-", " ")
    text = unicodedata.normalize("NFKD", text)
    text = "".join(ch for ch in text if not unicodedata.combining(ch))
    text = re.sub(r"\s+", " ", text).strip()
    return text


def parse_date_from_filename(filename: str):
    normalized = _normalize_text(filename)
    match = re.search(r"(\d{1,2})\s+([a-z]+)\s+(\d{4})", normalized)
    if not match:
        return None
    day = int(match.group(1))
    month_name = match.group(2)
    year = int(match.group(3))
    month = MONTHS_MAP.get(month_name)
    if not month:
        return None
    try:
        return date(year, month, day)
    except ValueError:
        return None


def pick_pdfs_by_month(pdf_dir: Path):
    pdfs = []
    for pdf in pdf_dir.glob("*.pdf"):
        parsed = parse_date_from_filename(pdf.name)
        if not parsed:
            continue
        pdfs.append((parsed, pdf))

    grouped = defaultdict(list)
    for dt, pdf in pdfs:
        key = (dt.year, dt.month)
        grouped[key].append((dt, pdf))

    chosen = []
    for key, entries in grouped.items():
        entries.sort(key=lambda x: x[0], reverse=True)
        chosen.append(entries[0][1])

    chosen.sort(key=lambda p: parse_date_from_filename(p.name) or date.min)
    return chosen


def select_map_image(result, map_preference: str):
    maps = result.get("maps", [])
    if not maps:
        return None

    if map_preference == "observation":
        for m in maps:
            if m.get("type") == "observation":
                return m
    if map_preference == "forecast":
        for m in maps:
            if m.get("type") == "forecast":
                return m

    for m in maps:
        if m.get("type") == "observation":
            return m
    return maps[0]


def create_mapping(pdf_dir: Path, output_json: Path, output_dir: Path, map_preference: str):
    if not pdf_dir.exists():
        print(f"ERREUR: Dossier introuvable: {pdf_dir}")
        return

    output_dir.mkdir(parents=True, exist_ok=True)

    pdfs = pick_pdfs_by_month(pdf_dir)
    if not pdfs:
        print(f"ERREUR: Aucun PDF utilisable dans {pdf_dir}")
        return

    extractor = PDFExtractor(pdf_directory=pdf_dir, output_directory=output_dir)

    per_month_data = []
    last_rois = None
    last_dims = None

    for pdf_path in pdfs:
        result = extractor.process_single_pdf(pdf_path)
        map_entry = select_map_image(result, map_preference)
        if not map_entry:
            print(f" -> {pdf_path.name}: aucune carte d?tect?e")
            continue

        image_path = map_entry.get("image_path")
        if not image_path or not os.path.exists(image_path):
            print(f" -> {pdf_path.name}: image manquante")
            continue

        img_original = cv2.imread(image_path)
        if img_original is None:
            print(f" -> {pdf_path.name}: erreur lecture image")
            continue

        h_orig, w_orig = img_original.shape[:2]

        # Redimensionnement intelligent pour l'?cran
        HAUTEUR_ECRAN_MAX = 1000
        scale_factor = 1.0
        if h_orig > HAUTEUR_ECRAN_MAX:
            scale_factor = HAUTEUR_ECRAN_MAX / h_orig
            new_w = int(w_orig * scale_factor)
            new_h = int(h_orig * scale_factor)
            img_base_display = cv2.resize(img_original, (new_w, new_h))
        else:
            img_base_display = img_original.copy()

        print(f"\n=== Mapping pour {pdf_path.name} ({map_entry.get('type')}) ===")
        config = {}

        for station in STATIONS:
            station_config = {}

            for data_key, info in INFO_TYPE.items():
                img_prompt = img_base_display.copy()

                cv2.rectangle(img_prompt, (0, 0), (img_prompt.shape[1], 80), (255, 255, 255), -1)
                cv2.putText(img_prompt, f"STATION : {station.upper()}", (20, 30),
                            cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 0, 0), 2)
                cv2.putText(img_prompt, f"CIBLE : {info['label']}", (20, 65),
                            cv2.FONT_HERSHEY_SIMPLEX, 1.0, info['color'], 3)
                cv2.putText(img_prompt, "ESPACE: Valider | C: Annuler", (img_prompt.shape[1] - 350, 50),
                            cv2.FONT_HERSHEY_SIMPLEX, 0.6, (100, 100, 100), 1)

                # Overlay last ROI as a hint
                if last_rois and last_dims:
                    prev_roi = last_rois.get(station, {}).get(f"{data_key}_roi")
                    if prev_roi:
                        prev_w, prev_h = last_dims
                        ratio_x = w_orig / float(prev_w)
                        ratio_y = h_orig / float(prev_h)
                        x1 = int(prev_roi[0] * ratio_x * scale_factor)
                        y1 = int(prev_roi[1] * ratio_y * scale_factor)
                        x2 = int(prev_roi[2] * ratio_x * scale_factor)
                        y2 = int(prev_roi[3] * ratio_y * scale_factor)
                        cv2.rectangle(img_prompt, (x1, y1), (x2, y2), (0, 0, 0), 1)

                window_name = "Outil de Mapping Meteo"
                roi = cv2.selectROI(window_name, img_prompt, showCrosshair=True, fromCenter=False)

                if roi == (0, 0, 0, 0):
                    print(f" -> {station} ({data_key}): Ignor?")
                    station_config[f"{data_key}_roi"] = None
                else:
                    x_disp, y_disp, w_disp, h_disp = roi

                    x1 = int(x_disp / scale_factor)
                    y1 = int(y_disp / scale_factor)
                    x2 = int((x_disp + w_disp) / scale_factor)
                    y2 = int((y_disp + h_disp) / scale_factor)

                    margin = 10
                    x1 -= margin
                    y1 -= margin
                    x2 += margin
                    y2 += margin

                    x1, y1 = max(0, x1), max(0, y1)
                    x2, y2 = min(w_orig, x2), min(h_orig, y2)

                    station_config[f"{data_key}_roi"] = [x1, y1, x2, y2]
                    print(f" -> {station} ({data_key}): OK")

            config[station] = station_config

        per_month_data.append(
            {
                "pdf": pdf_path.name,
                "image_width": w_orig,
                "image_height": h_orig,
                "map_type": map_entry.get("type"),
                "rois": config,
            }
        )

        last_rois = config
        last_dims = (w_orig, h_orig)

    cv2.destroyAllWindows()

    if not per_month_data:
        print("Aucune donn?e collect?e.")
        return

    base_w = int(round(median([item["image_width"] for item in per_month_data])))
    base_h = int(round(median([item["image_height"] for item in per_month_data])))

    merged = {"roi_base_width": base_w, "roi_base_height": base_h}

    for station in STATIONS:
        station_out = {}
        for data_key in INFO_TYPE.keys():
            samples = []
            for entry in per_month_data:
                roi = entry["rois"].get(station, {}).get(f"{data_key}_roi")
                if not roi:
                    continue
                scale_x = base_w / float(entry["image_width"])
                scale_y = base_h / float(entry["image_height"])
                samples.append([
                    int(round(roi[0] * scale_x)),
                    int(round(roi[1] * scale_y)),
                    int(round(roi[2] * scale_x)),
                    int(round(roi[3] * scale_y)),
                ])

            if not samples:
                station_out[f"{data_key}_roi"] = None
                continue

            xs1 = [s[0] for s in samples]
            ys1 = [s[1] for s in samples]
            xs2 = [s[2] for s in samples]
            ys2 = [s[3] for s in samples]
            station_out[f"{data_key}_roi"] = [
                int(round(median(xs1))),
                int(round(median(ys1))),
                int(round(median(xs2))),
                int(round(median(ys2))),
            ]

        merged[station] = station_out

    output_json.write_text(json.dumps(merged, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\nSucc?s ! Configuration sauvegard?e dans {output_json}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Mapping ROI ? partir d'un bulletin par mois.")
    parser.add_argument("--pdf-dir", type=str, default=str(PDF_DIR))
    parser.add_argument("--output", type=str, default=str(OUTPUT_JSON))
    parser.add_argument("--output-dir", type=str, default=str(DEFAULT_OUTPUT_DIR))
    parser.add_argument("--map", type=str, choices=["auto", "observation", "forecast"], default="auto")
    args = parser.parse_args()

    create_mapping(
        pdf_dir=Path(args.pdf_dir),
        output_json=Path(args.output),
        output_dir=Path(args.output_dir),
        map_preference=args.map,
    )
