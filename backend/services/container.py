from backend.repositories import (
    AppStateRepository,
    BulletinRepository,
    JobRepository,
    MetricsRepository,
    PipelineRunRepository,
    ValidationRepository,
)
from backend.services.app_state import AppStateService
from backend.services.bulletins import BulletinService
from backend.services.jobs import JobService
from backend.services.metrics import MetricsService
from backend.services.pipeline import PipelineService
from backend.services.validation import ValidationService
from backend.utils.config import Config
from backend.utils.database import DatabaseManager


class ServiceContainer:
    def __init__(self, db_manager: DatabaseManager, config: Config) -> None:
        self.db_manager = db_manager
        self.config = config

        self._bulletins_repo = BulletinRepository(db_manager)
        self._pipeline_repo = PipelineRunRepository(db_manager)
        self._metrics_repo = MetricsRepository(db_manager)
        self._validation_repo = ValidationRepository(db_manager)
        self._app_state_repo = AppStateRepository(db_manager)
        self._jobs_repo = JobRepository(db_manager)

        self.bulletins = BulletinService(self._bulletins_repo)
        self.pipeline = PipelineService(self._pipeline_repo)
        self.metrics = MetricsService(self._metrics_repo, self._bulletins_repo, db_manager)
        self.validation = ValidationService(self._validation_repo)
        self.app_state = AppStateService(self._app_state_repo)
        self.jobs = JobService(self._jobs_repo)
