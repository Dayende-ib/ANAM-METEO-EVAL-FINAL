from typing import Dict, List, Optional

from backend.repositories.jobs import JobRepository


class JobService:
    def __init__(self, repo: JobRepository) -> None:
        self._repo = repo

    def create(self, job_id: str, job_type: str, payload: Dict) -> None:
        self._repo.create(job_id, job_type, payload)

    def get(self, job_id: str) -> Optional[Dict]:
        return self._repo.get(job_id)

    def get_many(self, job_ids: List[str]) -> List[Dict]:
        return self._repo.get_many(job_ids)

    def update(
        self,
        job_id: str,
        status: Optional[str] = None,
        result: Optional[Dict] = None,
        error_message: Optional[str] = None,
    ) -> None:
        self._repo.update(job_id, status=status, result=result, error_message=error_message)
