from typing import Optional

from backend.repositories.app_state import AppStateRepository


class AppStateService:
    def __init__(self, repo: AppStateRepository) -> None:
        self._repo = repo

    def get(self, key: str) -> Optional[str]:
        return self._repo.get(key)

    def set(self, key: str, value: str) -> None:
        self._repo.set(key, value)
