from __future__ import annotations

from typing import Dict, Iterable, Optional, Tuple

RESERVED_KEYS = {"roi_base_width", "roi_base_height"}


def iter_station_rois(roi_config: Dict) -> Iterable[Tuple[str, Dict]]:
    if not isinstance(roi_config, dict):
        return []
    for station, rois in roi_config.items():
        if station in RESERVED_KEYS:
            continue
        if not isinstance(rois, dict):
            continue
        yield station, rois


def extract_base_dimensions(roi_config: Dict) -> Tuple[Optional[int], Optional[int]]:
    if not isinstance(roi_config, dict):
        return None, None

    base_w = roi_config.get("roi_base_width")
    base_h = roi_config.get("roi_base_height")
    if isinstance(base_w, (int, float)) and isinstance(base_h, (int, float)):
        if base_w > 0 and base_h > 0:
            return int(base_w), int(base_h)

    max_x = 0
    max_y = 0
    for _, rois in iter_station_rois(roi_config):
        for key in ("tmin_roi", "tmax_roi", "icon_roi"):
            roi = rois.get(key)
            if not roi or len(roi) < 4:
                continue
            try:
                max_x = max(max_x, int(roi[2]))
                max_y = max(max_y, int(roi[3]))
            except (TypeError, ValueError):
                continue

    if max_x <= 0 or max_y <= 0:
        return None, None

    # Keep the historical +5px margin used by TemperatureExtractor auto-detection.
    return max_x + 5, max_y + 5


def get_scale_factors(roi_config: Dict, image_shape) -> Tuple[float, float]:
    if image_shape is None:
        return 1.0, 1.0
    try:
        height, width = image_shape[:2]
    except Exception:
        return 1.0, 1.0

    base_w, base_h = extract_base_dimensions(roi_config)
    if not base_w or not base_h:
        return 1.0, 1.0

    scale_x = width / float(base_w)
    scale_y = height / float(base_h)
    return scale_x, scale_y


def scale_roi(
    roi,
    scale_x: float,
    scale_y: float,
    pad: int = 5,
    image_shape=None,
):
    if not roi or len(roi) < 4:
        return None
    try:
        x1, y1, x2, y2 = [int(v) for v in roi]
    except (TypeError, ValueError):
        return None

    x1 = int(round(x1 * scale_x)) - pad
    y1 = int(round(y1 * scale_y)) - pad
    x2 = int(round(x2 * scale_x)) + pad
    y2 = int(round(y2 * scale_y)) + pad

    if image_shape is not None:
        try:
            height, width = image_shape[:2]
            x1 = max(0, x1)
            y1 = max(0, y1)
            x2 = min(width, x2)
            y2 = min(height, y2)
        except Exception:
            pass

    if x2 <= x1 or y2 <= y1:
        return None

    return [x1, y1, x2, y2]
