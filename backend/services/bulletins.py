from typing import Dict, List

from backend.repositories.bulletins import BulletinRepository


class BulletinService:
    def __init__(self, repo: BulletinRepository) -> None:
        self._repo = repo

    def list_summaries(self, limit: int = 50, offset: int = 0) -> List[Dict]:
        return self._repo.list_summaries(limit=limit, offset=offset)

    def count_summaries(self) -> int:
        return self._repo.count_summaries()

    def list_payloads_by_date(self, bulletin_date: str) -> List[Dict]:
        return self._repo.list_payloads_by_date(bulletin_date)

    def update_bulletin_interpretations(self, date: str, bulletin_type: str, interpretations: Dict) -> int:
        return self._repo.update_bulletin_interpretations(date, bulletin_type, interpretations)

    def upsert_station_snapshot(self, pdf_path, station_snapshot: Dict) -> None:
        self._repo.upsert_station_snapshot(pdf_path, station_snapshot)

    def upsert_bulletin_payload(self, pdf_path, payload: Dict) -> None:
        self._repo.upsert_bulletin_payload(pdf_path, payload)

    def list_bulletin_dates(self, bulletin_type: str) -> List[str]:
        return self._repo.list_bulletin_dates(bulletin_type)

    def get_latest_bulletin_date(self):
        return self._repo.get_latest_bulletin_date()
