/**
 * Composant global pour afficher les tâches en arrière-plan
 * Visible sur toutes les pages, persiste entre les navigations
 */

import { useBackgroundTasks } from "../hooks/useBackgroundTasks";
import { BackgroundTask } from "../services/backgroundTasksStore";

export function BackgroundTasksNotifier() {
  const { activeTasks, cancelTask, removeTask } = useBackgroundTasks();

  if (activeTasks.length === 0) {
    return null;
  }

  return (
    <div className="fixed bottom-4 right-4 z-50 space-y-3 max-w-md">
      {activeTasks.map((task) => (
        <TaskCard key={task.id} task={task} onCancel={cancelTask} onRemove={removeTask} />
      ))}
    </div>
  );
}

interface TaskCardProps {
  task: BackgroundTask;
  onCancel: (taskId: string) => void;
  onRemove: (taskId: string) => void;
}

function TaskCard({ task, onCancel, onRemove }: TaskCardProps) {
  const progressPercent = (task.progress.current / task.progress.total) * 100;
  const elapsedTime = Math.floor((Date.now() - task.metadata.startTime) / 1000);
  const estimatedRemaining = task.progress.current > 0
    ? Math.ceil((elapsedTime / task.progress.current) * (task.progress.total - task.progress.current))
    : 0;

  // Icône selon le statut
  const getStatusIcon = () => {
    switch (task.status) {
      case "pending":
        return "schedule";
      case "running":
        return "progress_activity";
      case "completed":
        return "check_circle";
      case "failed":
        return "error";
      case "cancelled":
        return "cancel";
      default:
        return "info";
    }
  };

  // Couleur selon le statut
  const getStatusColor = () => {
    switch (task.status) {
      case "completed":
        return "emerald";
      case "failed":
        return "red";
      case "cancelled":
        return "gray";
      default:
        return "blue";
    }
  };

  const statusColor = getStatusColor();

  return (
    <div
      className="surface-panel p-4 shadow-2xl border-l-4 animate-slide-in-right"
      style={{ borderLeftColor: `var(--${statusColor === "emerald" ? "accent" : statusColor === "red" ? "red-500" : "blue-500"})` }}
    >
      {/* En-tête */}
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2">
          <span
            className={`material-symbols-outlined text-xl ${
              task.status === "running" ? "animate-spin" : ""
            }`}
            style={{ color: task.status === "completed" ? "#10b981" : task.status === "failed" ? "#ef4444" : "#3b82f6" }}
          >
            {getStatusIcon()}
          </span>
          <div>
            <h4 className="text-sm font-semibold text-ink">
              {task.type === "bulk_translation"
                ? "Traductions en masse"
                : task.type === "bulletin_reprocess"
                ? "Ré-extraction bulletins"
                : "Traduction"}
            </h4>
            <p className="text-xs text-muted">
              {task.type === "bulletin_reprocess"
                ? task.metadata.label || "Traitement OCR"
                : (task.metadata.languages ?? []).join(", ")}
            </p>
          </div>
        </div>
        <button
          onClick={() => (task.status === "completed" || task.status === "failed" || task.status === "cancelled" ? onRemove(task.id) : onCancel(task.id))}
          className="text-muted hover:text-ink transition-colors"
          aria-label={task.status === "running" ? "Annuler" : "Fermer"}
        >
          <span className="material-symbols-outlined text-lg">
            {task.status === "running" || task.status === "pending" ? "close" : "check"}
          </span>
        </button>
      </div>

      {/* Barre de progression */}
      {(task.status === "running" || task.status === "pending") && (
        <>
          <div className="relative h-2 w-full bg-gray-200 rounded-full overflow-hidden mb-2">
            <div
              className="absolute inset-y-0 left-0 bg-gradient-to-r from-blue-500 to-blue-600 rounded-full transition-all duration-500"
              style={{ width: `${progressPercent}%` }}
            >
              <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/30 to-transparent animate-shimmer"></div>
            </div>
          </div>
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted">
              {task.progress.current} / {task.progress.total} terminées
            </span>
            <span className="text-muted font-mono">
              ⏱️ ~{Math.floor(estimatedRemaining / 60)}m {estimatedRemaining % 60}s
            </span>
          </div>
        </>
      )}

      {/* Résultat final */}
      {task.status === "completed" && task.result && (
        <div className="text-xs text-emerald-700 bg-emerald-50 rounded-lg p-2">
          ✓ {task.result.successCount} réussies, {task.result.failedCount} échouées
          {typeof task.result.skippedCount === "number" && (
            <> • {task.result.skippedCount} ignorées</>
          )}
          {typeof task.result.missingCount === "number" && (
            <> • {task.result.missingCount} manquantes</>
          )}
        </div>
      )}

      {task.status === "failed" && (
        <div className="text-xs text-red-700 bg-red-50 rounded-lg p-2">
          ✗ Échec : {task.error || "Erreur inconnue"}
        </div>
      )}

      {task.status === "cancelled" && (
        <div className="text-xs text-gray-600 bg-gray-50 rounded-lg p-2">
          ⊘ Opération annulée
        </div>
      )}
    </div>
  );
}
