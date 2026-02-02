import { useSyncExternalStore } from "react";
import {
 clearError,
 clearTransientStatus,
 statusStore,
} from "../services/statusStore";

const useStatus = () =>
 useSyncExternalStore(statusStore.subscribe, statusStore.getState, statusStore.getState);

export function GlobalStatusIndicator() {
 const { activeRequests, lastError, pipelineRunning, scrapeRunning } = useStatus();
 const showRequests = activeRequests > 0;
 const showBadge = showRequests || Boolean(lastError) || pipelineRunning || scrapeRunning;
 const canClear = Boolean(lastError) || pipelineRunning || scrapeRunning;

 if (!showBadge) {
  return null;
 }

 return (
  <div className="fixed bottom-6 right-6 z-50 max-w-[280px]">
   <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)]/90 shadow-lg backdrop-blur px-4 py-3 text-xs text-ink ">
    <div className="flex items-start justify-between gap-3">
     <div className="space-y-2">
      {pipelineRunning && (
       <div className="flex items-center gap-2">
        <span className="material-symbols-outlined text-sm text-emerald-600">
         sync
        </span>
        <span>Pipeline en cours</span>
       </div>
      )}
      {scrapeRunning && (
       <div className="flex items-center gap-2">
        <span className="material-symbols-outlined text-sm text-amber-600">
         cloud_download
        </span>
        <span>Scraping en cours</span>
       </div>
      )}
      {showRequests && (
       <div className="flex items-center gap-2">
        <span className="material-symbols-outlined text-sm text-blue-600">
         progress_activity
        </span>
        <span>{activeRequests} requete(s) API</span>
       </div>
      )}
      {lastError && (
       <div className="flex items-start gap-2 text-red-600">
        <span className="material-symbols-outlined text-sm">error</span>
        <span className="text-red-600 line-clamp-2">{lastError}</span>
       </div>
      )}
     </div>
     <div className="flex items-center gap-2">
      {lastError && (
       <button
        type="button"
        className="text-muted hover:text-ink"
        onClick={clearError}
        aria-label="Masquer l'erreur"
       >
        <span className="material-symbols-outlined text-base">close</span>
       </button>
      )}
      {canClear && (
       <button
        type="button"
        className="text-muted hover:text-ink text-xs font-semibold"
        onClick={clearTransientStatus}
       >
        Effacer
       </button>
      )}
     </div>
    </div>
   </div>
  </div>
 );
}
