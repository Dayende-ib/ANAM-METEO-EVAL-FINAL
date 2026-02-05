from typing import Any, Dict, List, Optional

from backend.utils.database import DatabaseManager


class PipelineRunRepository:
    def __init__(self, db_manager: DatabaseManager) -> None:
        self._db = db_manager

    def has_active_run(self) -> bool:
        return self._db.has_active_pipeline_run()

    def create_run(self, steps_template, metadata: Optional[Dict[str, Any]] = None) -> int:
        return self._db.create_pipeline_run(steps_template, metadata=metadata)

    def update_run(
        self,
        run_id: int,
        status: Optional[str] = None,
        steps: Optional[List[Dict[str, Any]]] = None,
        error_message: Optional[str] = None,
        metadata: Optional[Dict[str, Any]] = None,
        finished: bool = False,
    ) -> None:
        self._db.update_pipeline_run(
            run_id,
            status=status,
            steps=steps,
            error_message=error_message,
            metadata=metadata,
            finished=finished,
        )

    def list_runs(self, limit: int = 20, offset: int = 0):
        return self._db.list_pipeline_runs(limit=limit, offset=offset)

    def get_run(self, run_id: int):
        return self._db.get_pipeline_run(run_id)
