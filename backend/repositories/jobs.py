from typing import Dict, List, Optional

from backend.utils.database import DatabaseManager


class JobRepository:
    def __init__(self, db_manager: DatabaseManager) -> None:
        self._db = db_manager

    def create(self, job_id: str, job_type: str, payload: Dict) -> None:
        self._db.create_job(job_id, job_type, payload)

    def get(self, job_id: str) -> Optional[Dict]:
        return self._db.get_job(job_id)

    def get_many(self, job_ids: List[str]) -> List[Dict]:
        return self._db.get_jobs(job_ids)

    def update(
        self,
        job_id: str,
        status: Optional[str] = None,
        result: Optional[Dict] = None,
        error_message: Optional[str] = None,
    ) -> None:
        self._db.update_job(job_id, status=status, result=result, error_message=error_message)
