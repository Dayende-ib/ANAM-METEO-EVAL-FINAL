"""
Gestionnaire de tâches en arrière-plan pour les traductions NLLB.
Permet d'éviter le blocage de l'API pendant les traductions longues.
"""
import asyncio
import logging
import time
import uuid
from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from typing import Any, Dict, Optional
from concurrent.futures import ThreadPoolExecutor

logger = logging.getLogger(__name__)


class TaskStatus(str, Enum):
    """Statuts possibles d'une tâche."""
    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


@dataclass
class BackgroundTask:
    """Représentation d'une tâche en arrière-plan."""
    task_id: str
    task_type: str
    status: TaskStatus = TaskStatus.PENDING
    created_at: datetime = field(default_factory=datetime.now)
    started_at: Optional[datetime] = None
    finished_at: Optional[datetime] = None
    progress: float = 0.0  # 0.0 à 1.0
    result: Optional[Dict[str, Any]] = None
    error: Optional[str] = None
    metadata: Dict[str, Any] = field(default_factory=dict)


class BackgroundTaskManager:
    """
    Gestionnaire de tâches en arrière-plan.
    
    Utilise un ThreadPoolExecutor pour exécuter les tâches de traduction
    sans bloquer l'event loop de FastAPI.
    """
    
    def __init__(self, max_workers: int = 2):
        """
        Initialise le gestionnaire de tâches.
        
        Args:
            max_workers: Nombre maximum de traductions simultanées.
                        2 par défaut pour éviter la surcharge mémoire (NLLB = 1.2GB/modèle).
        """
        self.executor = ThreadPoolExecutor(max_workers=max_workers)
        self.tasks: Dict[str, BackgroundTask] = {}
        self.max_workers = max_workers
        logger.info(f"✅ BackgroundTaskManager initialisé avec {max_workers} workers")
    
    def create_task(
        self,
        task_type: str,
        metadata: Optional[Dict[str, Any]] = None
    ) -> str:
        """
        Crée une nouvelle tâche et retourne son ID.
        
        Args:
            task_type: Type de tâche (ex: "translation", "bulk_translation")
            metadata: Métadonnées optionnelles
            
        Returns:
            ID unique de la tâche
        """
        task_id = str(uuid.uuid4())
        task = BackgroundTask(
            task_id=task_id,
            task_type=task_type,
            metadata=metadata or {}
        )
        self.tasks[task_id] = task
        logger.info(f"📝 Tâche créée : {task_id} ({task_type})")
        return task_id
    
    def get_task(self, task_id: str) -> Optional[BackgroundTask]:
        """Récupère une tâche par son ID."""
        return self.tasks.get(task_id)
    
    def get_all_tasks(self) -> Dict[str, BackgroundTask]:
        """Récupère toutes les tâches."""
        return self.tasks.copy()
    
    def get_running_tasks_count(self) -> int:
        """Retourne le nombre de tâches en cours d'exécution."""
        return sum(1 for task in self.tasks.values() if task.status == TaskStatus.RUNNING)
    
    async def submit_translation_task(
        self,
        task_id: str,
        translation_func,
        *args,
        **kwargs
    ):
        """
        Soumet une tâche de traduction au pool de threads.
        
        Args:
            task_id: ID de la tâche
            translation_func: Fonction de traduction à exécuter
            *args, **kwargs: Arguments pour la fonction
        """
        task = self.tasks.get(task_id)
        if not task:
            logger.error(f"❌ Tâche {task_id} introuvable")
            return
        
        # Marquer la tâche comme en cours
        task.status = TaskStatus.RUNNING
        task.started_at = datetime.now()
        logger.info(f"🚀 Démarrage de la tâche {task_id}")
        
        try:
            # Exécuter la fonction dans le pool de threads
            loop = asyncio.get_event_loop()
            result = await loop.run_in_executor(
                self.executor,
                translation_func,
                *args,
                **kwargs
            )
            
            # Marquer comme terminée
            task.status = TaskStatus.COMPLETED
            task.finished_at = datetime.now()
            task.progress = 1.0
            task.result = result
            
            duration = (task.finished_at - task.started_at).total_seconds()
            logger.info(f"✅ Tâche {task_id} terminée avec succès en {duration:.2f}s")
            
        except Exception as exc:
            # Marquer comme échouée
            task.status = TaskStatus.FAILED
            task.finished_at = datetime.now()
            task.error = str(exc)
            
            logger.error(f"❌ Tâche {task_id} échouée : {exc}")
    
    def cancel_task(self, task_id: str) -> bool:
        """
        Annule une tâche en attente.
        
        Note: Les tâches en cours d'exécution ne peuvent pas être annulées
        car le modèle NLLB est déjà en train de générer.
        
        Returns:
            True si la tâche a été annulée, False sinon
        """
        task = self.tasks.get(task_id)
        if not task:
            return False
        
        if task.status == TaskStatus.PENDING:
            task.status = TaskStatus.CANCELLED
            task.finished_at = datetime.now()
            logger.info(f"🚫 Tâche {task_id} annulée")
            return True
        
        logger.warning(f"⚠️  Impossible d'annuler la tâche {task_id} (status: {task.status})")
        return False
    
    def cleanup_old_tasks(self, max_age_seconds: int = 3600):
        """
        Nettoie les anciennes tâches terminées.
        
        Args:
            max_age_seconds: Age maximum en secondes (défaut: 1 heure)
        """
        now = datetime.now()
        to_remove = []
        
        for task_id, task in self.tasks.items():
            if task.status in [TaskStatus.COMPLETED, TaskStatus.FAILED, TaskStatus.CANCELLED]:
                if task.finished_at:
                    age = (now - task.finished_at).total_seconds()
                    if age > max_age_seconds:
                        to_remove.append(task_id)
        
        for task_id in to_remove:
            del self.tasks[task_id]
            logger.info(f"🧹 Tâche {task_id} supprimée (ancienne)")
        
        if to_remove:
            logger.info(f"🧹 {len(to_remove)} tâche(s) nettoyée(s)")
    
    def shutdown(self):
        """Arrête proprement le gestionnaire de tâches."""
        logger.info("🛑 Arrêt du BackgroundTaskManager...")
        self.executor.shutdown(wait=True)
        logger.info("✅ BackgroundTaskManager arrêté")


# Instance globale du gestionnaire de tâches
_task_manager: Optional[BackgroundTaskManager] = None


def get_task_manager() -> BackgroundTaskManager:
    """Retourne l'instance globale du gestionnaire de tâches."""
    global _task_manager
    if _task_manager is None:
        _task_manager = BackgroundTaskManager(max_workers=2)
    return _task_manager


def shutdown_task_manager():
    """Arrête le gestionnaire de tâches global."""
    global _task_manager
    if _task_manager is not None:
        _task_manager.shutdown()
        _task_manager = None
