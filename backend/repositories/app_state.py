from typing import Optional

from backend.utils.database import DatabaseManager


class AppStateRepository:
    def __init__(self, db_manager: DatabaseManager) -> None:
        self._db = db_manager

    def get(self, key: str) -> Optional[str]:
        return self._db.get_app_state(key)

    def set(self, key: str, value: str) -> None:
        self._db.set_app_state(key, value)
