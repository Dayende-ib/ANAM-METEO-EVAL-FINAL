#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""Helpers to normalize and parse Roboflow workflow responses."""

from typing import Any, Dict, List, Optional


def normalize_workflow_response(response: Any) -> Dict[str, Any]:
    if isinstance(response, list):
        if len(response) == 1 and isinstance(response[0], dict):
            return response[0]
        return {"items": response}
    if isinstance(response, dict):
        return response
    return {"value": response}


def extract_predictions(response: Any) -> List[Dict[str, Any]]:
    collected: List[Dict[str, Any]] = []

    def _walk(node: Any) -> None:
        if isinstance(node, dict):
            preds = node.get("predictions")
            if isinstance(preds, list):
                collected.extend([p for p in preds if isinstance(p, dict)])
            elif isinstance(preds, dict):
                inner = preds.get("predictions")
                if isinstance(inner, list):
                    collected.extend([p for p in inner if isinstance(p, dict)])
            for value in node.values():
                _walk(value)
        elif isinstance(node, list):
            for item in node:
                _walk(item)

    _walk(response)
    return collected


def prediction_to_bbox(prediction: Dict[str, Any]) -> Optional[tuple]:
    try:
        width = float(prediction.get("width", 0))
        height = float(prediction.get("height", 0))
        center_x = float(prediction.get("x", 0))
        center_y = float(prediction.get("y", 0))
    except (TypeError, ValueError):
        return None

    if width <= 0 or height <= 0:
        return None

    x1 = int(round(center_x - width / 2))
    y1 = int(round(center_y - height / 2))
    return (max(0, x1), max(0, y1), int(round(width)), int(round(height)))
