import sqlite3
from typing import Dict, List, Optional

from backend.utils.database import DatabaseManager


class BulletinRepository:
    def __init__(self, db_manager: DatabaseManager) -> None:
        self._db = db_manager

    def list_summaries(self, limit: int = 50, offset: int = 0) -> List[Dict]:
        return self._db.list_bulletin_summaries(limit=limit, offset=offset)

    def count_summaries(self) -> int:
        return self._db.count_bulletin_summaries()

    def list_payloads_by_date(self, bulletin_date: str) -> List[Dict]:
        return self._db.list_bulletin_payloads_by_date(bulletin_date)

    def update_bulletin_interpretations(self, date: str, bulletin_type: str, interpretations: Dict) -> int:
        return self._db.update_bulletin_interpretations(date, bulletin_type, interpretations)

    def upsert_station_snapshot(self, pdf_path, station_snapshot: Dict) -> None:
        self._db.upsert_station_snapshot(pdf_path, station_snapshot)

    def upsert_bulletin_payload(self, pdf_path, payload: Dict) -> None:
        self._db.upsert_bulletin_payload(pdf_path, payload)

    def list_bulletin_dates(self, bulletin_type: str) -> List[str]:
        return self._db.list_bulletin_dates(bulletin_type)

    def get_latest_bulletin_date(self) -> Optional[str]:
        conn = self._db.get_connection()
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        cursor.execute("SELECT MAX(date) AS max_date FROM bulletins")
        row = cursor.fetchone()
        if not row or not row["max_date"]:
            return None
        return str(row["max_date"])
