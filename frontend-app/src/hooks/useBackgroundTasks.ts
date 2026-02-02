/**
 * Hook React pour gérer les tâches en arrière-plan
 * Synchronise automatiquement l'état avec le store global
 */

import { useEffect, useState, useCallback } from "react";
import { backgroundTasksStore, BackgroundTask } from "../services/backgroundTasksStore";
import { getTranslationTaskStatus, fetchBulletins } from "../services/api";

export function useBackgroundTasks() {
  const [activeTasks, setActiveTasks] = useState<BackgroundTask[]>([]);
  const [allTasks, setAllTasks] = useState<BackgroundTask[]>([]);

  // Synchroniser avec le store
  useEffect(() => {
    const updateTasks = () => {
      setActiveTasks(backgroundTasksStore.getActiveTasks());
      setAllTasks(backgroundTasksStore.getAllTasks());
    };

    // Initial
    updateTasks();

    // S'abonner aux changements
    const unsubscribe = backgroundTasksStore.subscribe(updateTasks);

    return () => {
      unsubscribe();
    };
  }, []);

  // Reprendre le polling des tâches actives au montage
  useEffect(() => {
    activeTasks.forEach((task) => {
      if (task.status === "running" || task.status === "pending") {
        resumeTaskPolling(task.id);
      }
    });
  }, []); // Exécuter une seule fois au montage

  /**
   * Créer une tâche de génération en masse
   */
  const createBulkTranslationTask = useCallback(
    (taskIds: string[], metadata: { dateFilter?: string; typeFilter?: string; languages: string[] }) => {
      const taskId = backgroundTasksStore.createTask("bulk_translation", {
        taskIds,
        ...metadata,
      });

      // Démarrer le polling
      backgroundTasksStore.startPolling(taskId, async () => {
        await pollBulkTranslationProgress(taskId, taskIds);
      });

      return taskId;
    },
    []
  );

  /**
   * Polling de la progression d'une tâche en masse
   */
  const pollBulkTranslationProgress = async (taskId: string, apiTaskIds: string[]) => {
    const task = backgroundTasksStore.getTask(taskId);
    if (!task) return;

    let completedCount = 0;
    let failedCount = 0;

    // Vérifier le statut de chaque sous-tâche API
    for (const apiTaskId of apiTaskIds) {
      try {
        const status = await getTranslationTaskStatus(apiTaskId);
        if (status.status === "completed") {
          completedCount++;
        } else if (status.status === "failed") {
          failedCount++;
        }
      } catch (err) {
        failedCount++;
      }
    }

    const totalCompleted = completedCount + failedCount;
    const newStatus =
      totalCompleted >= apiTaskIds.length
        ? completedCount > failedCount
          ? "completed"
          : "failed"
        : "running";

    backgroundTasksStore.updateTask(taskId, {
      status: newStatus,
      progress: {
        current: totalCompleted,
        total: apiTaskIds.length,
      },
      result: {
        successCount: completedCount,
        failedCount: failedCount,
      },
    });

    // Si terminé, arrêter le polling et recharger les bulletins
    if (newStatus === "completed" || newStatus === "failed") {
      backgroundTasksStore.stopPolling(taskId);
      
      // ⚡ IMPORTANT: Recharger les bulletins pour rafraîchir les traductions dans la vue liste
      try {
        await fetchBulletins({ limit: 200 });
        console.log("✅ Bulletins rechargés après fin de tâche");
      } catch (err) {
        console.error("❌ Erreur lors du rechargement des bulletins:", err);
      }
    }
  };

  /**
   * Reprendre le polling d'une tâche existante
   */
  const resumeTaskPolling = useCallback((taskId: string) => {
    const task = backgroundTasksStore.getTask(taskId);
    if (!task) return;

    if (task.type === "bulk_translation") {
      backgroundTasksStore.startPolling(taskId, async () => {
        await pollBulkTranslationProgress(taskId, task.metadata.taskIds);
      });
    }
  }, []);

  /**
   * Annuler une tâche
   */
  const cancelTask = useCallback((taskId: string) => {
    backgroundTasksStore.cancelTask(taskId);
  }, []);

  /**
   * Supprimer une tâche terminée
   */
  const removeTask = useCallback((taskId: string) => {
    backgroundTasksStore.removeTask(taskId);
  }, []);

  /**
   * Nettoyer toutes les tâches terminées
   */
  const clearCompletedTasks = useCallback(() => {
    backgroundTasksStore.clearCompletedTasks();
  }, []);

  return {
    activeTasks,
    allTasks,
    createBulkTranslationTask,
    cancelTask,
    removeTask,
    clearCompletedTasks,
    hasActiveTasks: activeTasks.length > 0,
  };
}
