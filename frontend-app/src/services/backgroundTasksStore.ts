/**
 * Store global pour gérer les tâches en arrière-plan (traductions NLLB)
 * Permet de maintenir l'état des opérations même lors de la navigation entre pages
 */

export interface BackgroundTask {
  id: string;
  type: "bulk_translation" | "single_translation";
  status: "pending" | "running" | "completed" | "failed" | "cancelled";
  progress: {
    current: number;
    total: number;
  };
  metadata: {
    taskIds: string[];
    dateFilter?: string;
    typeFilter?: string;
    languages: string[];
    startTime: number;
  };
  result?: {
    successCount: number;
    failedCount: number;
  };
  error?: string;
}

interface TaskMetadata {
  taskIds: string[];
  dateFilter?: string;
  typeFilter?: string;
  languages: string[];
}

class BackgroundTasksStore {
  private tasks: Map<string, BackgroundTask> = new Map();
  private listeners: Set<() => void> = new Set();
  private readonly STORAGE_KEY = "anam_background_tasks";
  private pollingIntervals: Map<string, NodeJS.Timeout> = new Map();

  constructor() {
    // Restaurer les tâches depuis localStorage au démarrage
    this.restoreFromStorage();
    
    // Nettoyer les tâches terminées anciennes (>1h)
    this.cleanupOldTasks();
  }

  /**
   * Créer une nouvelle tâche
   */
  createTask(
    type: BackgroundTask["type"],
    metadata: TaskMetadata
  ): string {
    const taskId = `task_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    const task: BackgroundTask = {
      id: taskId,
      type,
      status: "pending",
      progress: { current: 0, total: metadata.taskIds.length },
      metadata: {
        ...metadata,
        startTime: Date.now(),
      },
    };

    this.tasks.set(taskId, task);
    this.persistToStorage();
    this.notifyListeners();
    
    return taskId;
  }

  /**
   * Mettre à jour une tâche
   */
  updateTask(taskId: string, updates: Partial<BackgroundTask>): void {
    const task = this.tasks.get(taskId);
    if (!task) return;

    Object.assign(task, updates);
    this.persistToStorage();
    this.notifyListeners();
  }

  /**
   * Obtenir une tâche par ID
   */
  getTask(taskId: string): BackgroundTask | undefined {
    return this.tasks.get(taskId);
  }

  /**
   * Obtenir toutes les tâches actives (pending, running)
   */
  getActiveTasks(): BackgroundTask[] {
    return Array.from(this.tasks.values()).filter(
      (task) => task.status === "pending" || task.status === "running"
    );
  }

  /**
   * Obtenir toutes les tâches
   */
  getAllTasks(): BackgroundTask[] {
    return Array.from(this.tasks.values());
  }

  /**
   * Supprimer une tâche
   */
  removeTask(taskId: string): void {
    // Arrêter le polling si actif
    const interval = this.pollingIntervals.get(taskId);
    if (interval) {
      clearInterval(interval);
      this.pollingIntervals.delete(taskId);
    }

    this.tasks.delete(taskId);
    this.persistToStorage();
    this.notifyListeners();
  }

  /**
   * Annuler une tâche
   */
  cancelTask(taskId: string): void {
    const task = this.tasks.get(taskId);
    if (!task) return;

    task.status = "cancelled";
    
    // Arrêter le polling
    const interval = this.pollingIntervals.get(taskId);
    if (interval) {
      clearInterval(interval);
      this.pollingIntervals.delete(taskId);
    }

    this.persistToStorage();
    this.notifyListeners();
  }

  /**
   * Démarrer le polling d'une tâche
   */
  startPolling(taskId: string, pollFn: () => Promise<void>): void {
    // Éviter les doublons
    if (this.pollingIntervals.has(taskId)) {
      return;
    }

    const interval = setInterval(async () => {
      const task = this.tasks.get(taskId);
      if (!task || task.status === "completed" || task.status === "failed" || task.status === "cancelled") {
        this.stopPolling(taskId);
        return;
      }

      try {
        await pollFn();
      } catch (err) {
        console.error(`Erreur lors du polling de la tâche ${taskId}:`, err);
      }
    }, 3000); // Polling toutes les 3 secondes

    this.pollingIntervals.set(taskId, interval);
  }

  /**
   * Arrêter le polling d'une tâche
   */
  stopPolling(taskId: string): void {
    const interval = this.pollingIntervals.get(taskId);
    if (interval) {
      clearInterval(interval);
      this.pollingIntervals.delete(taskId);
    }
  }

  /**
   * S'abonner aux changements
   */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Notifier tous les listeners
   */
  private notifyListeners(): void {
    this.listeners.forEach((listener) => listener());
  }

  /**
   * Persister dans localStorage
   */
  private persistToStorage(): void {
    try {
      const tasksArray = Array.from(this.tasks.values());
      localStorage.setItem(this.STORAGE_KEY, JSON.stringify(tasksArray));
    } catch (err) {
      console.error("Erreur lors de la sauvegarde des tâches:", err);
    }
  }

  /**
   * Restaurer depuis localStorage
   */
  private restoreFromStorage(): void {
    try {
      const stored = localStorage.getItem(this.STORAGE_KEY);
      if (!stored) return;

      const tasksArray: BackgroundTask[] = JSON.parse(stored);
      this.tasks = new Map(tasksArray.map((task) => [task.id, task]));
      
      // Nettoyer les tâches très anciennes (>1h) qui n'ont pas été nettoyées
      this.cleanupOldTasks();
      
      console.log(`✅ ${this.tasks.size} tâche(s) restaurée(s) depuis localStorage`);
    } catch (err) {
      console.error("Erreur lors de la restauration des tâches:", err);
      localStorage.removeItem(this.STORAGE_KEY);
    }
  }

  /**
   * Nettoyer les tâches terminées anciennes
   */
  private cleanupOldTasks(): void {
    const ONE_HOUR = 60 * 60 * 1000;
    const now = Date.now();
    
    let cleanedCount = 0;
    for (const [taskId, task] of this.tasks.entries()) {
      const isTerminated = ["completed", "failed", "cancelled"].includes(task.status);
      const isOld = now - task.metadata.startTime > ONE_HOUR;
      
      if (isTerminated && isOld) {
        this.tasks.delete(taskId);
        cleanedCount++;
      }
    }

    if (cleanedCount > 0) {
      console.log(`🧹 ${cleanedCount} tâche(s) ancienne(s) nettoyée(s)`);
      this.persistToStorage();
    }
  }

  /**
   * Nettoyer toutes les tâches terminées
   */
  clearCompletedTasks(): void {
    let cleanedCount = 0;
    for (const [taskId, task] of this.tasks.entries()) {
      if (["completed", "failed", "cancelled"].includes(task.status)) {
        this.tasks.delete(taskId);
        cleanedCount++;
      }
    }

    if (cleanedCount > 0) {
      console.log(`🧹 ${cleanedCount} tâche(s) terminée(s) supprimée(s)`);
      this.persistToStorage();
      this.notifyListeners();
    }
  }
}

// Instance singleton
export const backgroundTasksStore = new BackgroundTasksStore();
