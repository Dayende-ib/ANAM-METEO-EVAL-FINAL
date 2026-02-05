from typing import Dict, List, Optional

from backend.modules.forecast_evaluator import ForecastEvaluator
from backend.repositories.bulletins import BulletinRepository
from backend.repositories.metrics import MetricsRepository
from backend.utils.database import DatabaseManager


class MetricsService:
    def __init__(
        self,
        repo: MetricsRepository,
        bulletins_repo: BulletinRepository,
        db_manager: DatabaseManager,
    ) -> None:
        self._repo = repo
        self._bulletins_repo = bulletins_repo
        self._db = db_manager

    def get_evaluation_metrics(self, date: str) -> Optional[Dict]:
        return self._repo.get_evaluation_metrics(date)

    def list_evaluation_metrics(self, limit: int) -> List[Dict]:
        return self._repo.list_evaluation_metrics(limit)

    def recalculate(self, force: bool = False) -> Dict:
        evaluator = ForecastEvaluator(self._db)
        daily_result = evaluator.evaluate_forecasts(force_recalculate=force)
        monthly_result = evaluator.calculate_monthly_metrics_direct()
        station_result = evaluator.calculate_station_monthly_metrics()
        return {"daily": daily_result, "monthly": monthly_result, "station": station_result}

    def list_bulletin_dates(self, bulletin_type: str) -> List[str]:
        return self._bulletins_repo.list_bulletin_dates(bulletin_type)

    def get_monthly_metrics(self, year: int, month: int) -> Optional[Dict]:
        return self._repo.get_monthly_metrics(year, month)

    def list_monthly_metrics(self, limit: int) -> List[Dict]:
        return self._repo.list_monthly_metrics(limit)

    def list_all_stations_with_metrics(self) -> List[Dict]:
        return self._repo.list_all_stations_with_metrics()

    def get_station_monthly_metrics(self, station_id: int, year: int, month: int) -> Optional[Dict]:
        return self._repo.get_station_monthly_metrics(station_id, year, month)

    def list_station_monthly_metrics(self, station_id: int, limit: int) -> List[Dict]:
        return self._repo.list_station_monthly_metrics(station_id, limit)
