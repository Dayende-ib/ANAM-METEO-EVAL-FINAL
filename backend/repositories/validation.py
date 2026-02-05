from typing import Dict, List, Optional

from backend.utils.database import DatabaseManager


class ValidationRepository:
    def __init__(self, db_manager: DatabaseManager) -> None:
        self._db = db_manager

    def list_data_issues(
        self,
        date: Optional[str] = None,
        station_name: Optional[str] = None,
        severity: Optional[str] = None,
        status: Optional[str] = None,
        limit: int = 50,
        offset: int = 0,
    ) -> List[Dict]:
        return self._db.list_data_issues(
            date=date,
            station_name=station_name,
            severity=severity,
            status=status,
            limit=limit,
            offset=offset,
        )

    def count_data_issues(
        self,
        date: Optional[str] = None,
        station_name: Optional[str] = None,
        severity: Optional[str] = None,
        status: Optional[str] = None,
    ) -> int:
        return self._db.count_data_issues(
            date=date,
            station_name=station_name,
            severity=severity,
            status=status,
        )

    def update_data_issue_status(self, issue_id: int, status: str, note: Optional[str]) -> None:
        self._db.update_data_issue_status(issue_id, status, note)

    def update_temperatures_for_station(
        self,
        date: str,
        station_name: str,
        map_type: str,
        tmin: Optional[float],
        tmax: Optional[float],
    ) -> int:
        return self._db.update_temperatures_for_station(date, station_name, map_type, tmin, tmax)

    def get_average_quality_score(self, date: Optional[str] = None) -> Optional[float]:
        return self._db.get_average_quality_score(date=date)

    def count_quality_scores(self, date: Optional[str] = None) -> int:
        return self._db.count_quality_scores(date=date)
