from typing import Any, Dict, List, Optional

from backend.repositories.pipeline_runs import PipelineRunRepository


class PipelineService:
    def __init__(self, repo: PipelineRunRepository) -> None:
        self._repo = repo

    def has_active_run(self) -> bool:
        return self._repo.has_active_run()

    def create_run(self, steps_template, metadata: Optional[Dict[str, Any]] = None) -> int:
        return self._repo.create_run(steps_template, metadata=metadata)

    def update_run(
        self,
        run_id: int,
        status: Optional[str] = None,
        steps: Optional[List[Dict[str, Any]]] = None,
        error_message: Optional[str] = None,
        metadata: Optional[Dict[str, Any]] = None,
        finished: bool = False,
    ) -> None:
        self._repo.update_run(
            run_id,
            status=status,
            steps=steps,
            error_message=error_message,
            metadata=metadata,
            finished=finished,
        )

    def list_runs(self, limit: int = 20, offset: int = 0):
        return self._repo.list_runs(limit=limit, offset=offset)

    def get_run(self, run_id: int):
        return self._repo.get_run(run_id)
