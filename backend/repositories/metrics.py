import json
import sqlite3
from typing import Dict, List, Optional

from backend.utils.database import DatabaseManager


class MetricsRepository:
    def __init__(self, db_manager: DatabaseManager) -> None:
        self._db = db_manager

    def get_evaluation_metrics(self, date: str) -> Optional[Dict]:
        conn = self._db.get_connection()
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        cursor.execute(
            """
            SELECT bulletin_date, forecast_reference_date, mae_tmin, mae_tmax, rmse_tmin, rmse_tmax,
                   bias_tmin, bias_tmax, accuracy_weather, precision_weather, recall_weather,
                   f1_score_weather, weather_confusion, sample_size
            FROM evaluation_metrics
            WHERE bulletin_date = ?
            ORDER BY calculated_at DESC
            LIMIT 1
            """,
            (date,),
        )
        row = cursor.fetchone()
        if not row:
            return None
        confusion = json.loads(row["weather_confusion"]) if row["weather_confusion"] else None
        return {
            "date": row["bulletin_date"],
            "forecast_reference_date": row["forecast_reference_date"],
            "mae_tmin": row["mae_tmin"],
            "mae_tmax": row["mae_tmax"],
            "rmse_tmin": row["rmse_tmin"],
            "rmse_tmax": row["rmse_tmax"],
            "bias_tmin": row["bias_tmin"],
            "bias_tmax": row["bias_tmax"],
            "accuracy_weather": row["accuracy_weather"],
            "precision_weather": row["precision_weather"],
            "recall_weather": row["recall_weather"],
            "f1_score_weather": row["f1_score_weather"],
            "confusion_matrix": confusion,
            "sample_size": row["sample_size"],
        }

    def list_evaluation_metrics(self, limit: int) -> List[Dict]:
        conn = self._db.get_connection()
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        cursor.execute(
            """
            SELECT bulletin_date, forecast_reference_date, mae_tmin, mae_tmax, rmse_tmin, rmse_tmax,
                   bias_tmin, bias_tmax, accuracy_weather, precision_weather, recall_weather,
                   f1_score_weather, weather_confusion, sample_size, calculated_at
            FROM evaluation_metrics
            ORDER BY calculated_at DESC
            LIMIT ?
            """,
            (limit,),
        )
        rows = cursor.fetchall()
        items = []
        for row in rows:
            confusion = json.loads(row["weather_confusion"]) if row["weather_confusion"] else None
            items.append(
                {
                    "date": row["bulletin_date"],
                    "forecast_reference_date": row["forecast_reference_date"],
                    "mae_tmin": row["mae_tmin"],
                    "mae_tmax": row["mae_tmax"],
                    "rmse_tmin": row["rmse_tmin"],
                    "rmse_tmax": row["rmse_tmax"],
                    "bias_tmin": row["bias_tmin"],
                    "bias_tmax": row["bias_tmax"],
                    "accuracy_weather": row["accuracy_weather"],
                    "precision_weather": row["precision_weather"],
                    "recall_weather": row["recall_weather"],
                    "f1_score_weather": row["f1_score_weather"],
                    "confusion_matrix": confusion,
                    "sample_size": row["sample_size"],
                    "calculated_at": row["calculated_at"],
                }
            )
        return items

    def get_monthly_metrics(self, year: int, month: int) -> Optional[Dict]:
        return self._db.get_monthly_metrics(year, month)

    def list_monthly_metrics(self, limit: int) -> List[Dict]:
        return self._db.list_monthly_metrics(limit)

    def list_all_stations_with_metrics(self) -> List[Dict]:
        return self._db.list_all_stations_with_metrics()

    def get_station_monthly_metrics(self, station_id: int, year: int, month: int) -> Optional[Dict]:
        return self._db.get_station_monthly_metrics(station_id, year, month)

    def list_station_monthly_metrics(self, station_id: int, limit: int) -> List[Dict]:
        return self._db.list_station_monthly_metrics(station_id, limit)
