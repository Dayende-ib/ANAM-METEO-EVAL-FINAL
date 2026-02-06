import { useState, useEffect, useCallback, useMemo } from "react";
import { Layout } from "../components/Layout";
import {
 fetchPipelineRuns,
 fetchPipelineRunDetail,
 fetchScrapeManifest,
 stopPipelineRun,
 skipPipelineStep,
 triggerPipelineRun as triggerPipelineRunRequest,
 triggerScrape as triggerScrapeRequest,
 type PipelineRunDetailDto,
 type PipelineRunSummaryDto,
 type PipelineStepDto,
 type PipelineTriggerRequest,
 type ScrapeManifestRecord,
 type ScrapeManifestResponse,
 type ScrapeRequest,
} from "../services/api";
import { setPipelineRunning, setScrapeRunning } from "../services/statusStore";

// Types pour le pipeline
type PipelineStepKey =
 | "scraping"
 | "ocr"
 | "classification"
 | "integration"
 | "evaluation"
 | "interpretation"
 | string;

type StepState = "success" | "running" | "error" | "pending" | "skipped";

interface StepStatus {
 key: PipelineStepKey;
 label: string;
 status: StepState;
 startTime?: string;
 endTime?: string;
 duration?: number;
 errors?: string[];
 warnings?: string[];
 message?: string;
 meta?: Record<string, unknown>;
}

interface PipelineRunSummary {
 id: number;
 status: StepState | "pending";
 startedAt: string;
 finishedAt?: string;
 metadata?: Record<string, any>;
 errorMessage?: string | null;
 lastUpdate?: string | null;
}

interface PipelineRunDetail extends PipelineRunSummary {
 steps: StepStatus[];
}

type PipelineMetadata = {
 bulletins_processed?: number;
 total_duration?: number;
 notes?: string[];
 scraped_bulletins?: number;
 pending_pdfs?: number;
 interpreted_bulletins?: number;
};

const stepLabels: Record<string, string> = {
 scraping: "Scraping",
 ocr: "OCR",
 classification: "Classification",
 integration: "Intégration",
 evaluation: "Évaluation",
 interpretation: "Interprétation",
};

const stepIcons: Record<string, string> = {
 scraping: "web",
 ocr: "text_fields",
 classification: "category",
 integration: "merge",
 evaluation: "assessment",
 interpretation: "translate",
};

type ScrapeFormState = {
 year: string;
 month: string;
 day: string;
 maxPages: string;
 maxBulletins: string;
 delay: string;
 usePagination: boolean;
 maxSizeMb: string;
 retries: string;
 backoff: string;
 connectTimeout: string;
 readTimeout: string;
 verifySsl: boolean;
};

const SCRAPE_DEFAULT: ScrapeFormState = {
 year: "",
 month: "",
 day: "",
 maxPages: "",
 maxBulletins: "",
 delay: "1",
 usePagination: true,
 maxSizeMb: "",
 retries: "",
 backoff: "",
 connectTimeout: "",
 readTimeout: "",
 verifySsl: true,
};

type PipelineFormState = {
 useScraping: boolean;
 year: string;
 month: string;
 day: string;
 maxBulletins: string;
};

const PIPELINE_DEFAULT: PipelineFormState = {
 useScraping: true,
 year: "",
 month: "",
 day: "",
 maxBulletins: "",
};

const mapApiStep = (step: PipelineStepDto): StepStatus => {
 const start = step?.started_at || step?.startTime;
 const end = step?.finished_at || step?.endTime;
 let duration: number | undefined;
 if (start && end) {
  duration = Math.max(0, Math.round((new Date(end).getTime() - new Date(start).getTime()) / 1000));
 }
 return {
  key: (step?.key as PipelineStepKey) || step?.step || "scraping",
  label: step?.label || stepLabels[step?.key as string] || step?.key || "Étape",
  status: (step?.status as StepState) || "pending",
  startTime: start,
  endTime: end,
  duration,
  message: step?.message,
  meta: step?.meta,
  errors: step?.errors,
  warnings: step?.warnings,
 };
};

const mapRunSummary = (run: PipelineRunSummaryDto): PipelineRunSummary => ({
 id: Number(run?.id),
 status: (run?.status as StepState) || "pending",
 startedAt: run?.started_at || run?.start_time || new Date().toISOString(),
 finishedAt: run?.finished_at || run?.finish_time,
 metadata: run?.metadata || {},
 errorMessage: run?.error_message,
 lastUpdate: run?.last_update,
});

const mapRunDetail = (run: PipelineRunDetailDto): PipelineRunDetail => {
 const summary = mapRunSummary(run);
 const steps = Array.isArray(run?.steps) ? run.steps.map(mapApiStep) : [];
 return { ...summary, steps };
};

const getRunMetadata = (run?: PipelineRunSummary | PipelineRunDetail | null) =>
 ((run?.metadata || {}) as PipelineMetadata) || {};

const getRunDuration = (run: PipelineRunSummary | PipelineRunDetail | null) => {
 if (!run) return undefined;
 const meta = getRunMetadata(run);
 if (typeof meta.total_duration === "number") {
  return meta.total_duration;
 }
 if (run.startedAt && run.finishedAt) {
  return Math.max(0, Math.round((new Date(run.finishedAt).getTime() - new Date(run.startedAt).getTime()) / 1000));
 }
 return undefined;
};

const getBulletinsCount = (run?: PipelineRunSummary | PipelineRunDetail | null) => {
 const meta = getRunMetadata(run);
 if (typeof meta.bulletins_processed === "number") {
  return meta.bulletins_processed;
 }
 return 0;
};

const getNotesCount = (run?: PipelineRunSummary | PipelineRunDetail | null) => {
 const notes = getRunMetadata(run).notes;
 return Array.isArray(notes) ? notes.length : 0;
};

export function PilotagePipelinePage() {
 const [runs, setRuns] = useState<PipelineRunSummary[]>([]);
 const [runsLoading, setRunsLoading] = useState(false);
 const [runsError, setRunsError] = useState<string | null>(null);
 const [selectedRunId, setSelectedRunId] = useState<number | null>(null);
 const [selectedRun, setSelectedRun] = useState<PipelineRunDetail | null>(null);
 const [detailLoading, setDetailLoading] = useState(false);
 const [scrapeForm, setScrapeForm] = useState<ScrapeFormState>(SCRAPE_DEFAULT);
 const [scrapeLoading, setScrapeLoading] = useState(false);
 const [scrapeMessage, setScrapeMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
 const [recentDownloads, setRecentDownloads] = useState<
  { title?: string; path?: string; url?: string; status?: string; message?: string }[]
 >([]);
 const [manifestLoading, setManifestLoading] = useState(false);
 const [manifestError, setManifestError] = useState<string | null>(null);
 const [manifestData, setManifestData] = useState<ScrapeManifestResponse | null>(null);
 const [pipelineForm, setPipelineForm] = useState<PipelineFormState>(PIPELINE_DEFAULT);
 const [pipelineLoading, setPipelineLoading] = useState(false);
 const [pipelineMessage, setPipelineMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
 const [showAdvancedScrape, setShowAdvancedScrape] = useState(false);
 const latestRun = runs[0];
 const latestMetadata = getRunMetadata(latestRun);
 const manifestEntries = useMemo(() => {
  const items = manifestData?.manifest?.items;
  if (!items) return [];
  return Object.entries(items)
   .map(([url, record]) => ({ ...record, url: record.url || url }))
   .sort((a: ScrapeManifestRecord, b: ScrapeManifestRecord) => {
    const aTime = a.downloaded_at ? new Date(a.downloaded_at).getTime() : 0;
    const bTime = b.downloaded_at ? new Date(b.downloaded_at).getTime() : 0;
    return bTime - aTime;
   });
 }, [manifestData]);

 // Formater la durée en minutes et secondes
 const formatDuration = (seconds?: number) => {
  if (!seconds) return "N/A";
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}m ${secs}s`;
 };

 const formatBytes = (bytes?: number) => {
  if (bytes === undefined || bytes === null) return "--";
  const units = ["B", "KB", "MB", "GB"];
  let size = bytes;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
   size /= 1024;
   unit += 1;
  }
  return `${size.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
 };

 // Obtenir la couleur du statut
 const getStatusColor = (status: string) => {
  switch (status) {
   case "success":
    return "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300";
   case "running":
    return "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300";
   case "error":
    return "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300";
   case "pending":
    return "bg-[var(--canvas-strong)] text-ink";
   case "partial":
    return "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300";
   case "skipped":
    return "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200";
   default:
    return "bg-[var(--canvas-strong)] text-ink";
  }
 };

 // Obtenir l'icône du statut
 const getStatusIcon = (status: string) => {
  switch (status) {
   case "success":
    return "check_circle";
   case "running":
    return "sync";
   case "error":
    return "error";
   case "pending":
    return "schedule";
   case "skipped":
    return "block";
   default:
    return "help";
  }
 };

 const getStatusLabel = (status: string) => {
  switch (status) {
   case "success":
    return "Succès";
   case "running":
    return "En cours";
   case "error":
    return "Erreur";
   case "skipped":
    return "Sauté";
   default:
    return "En attente";
  }
 };

 const handleScrapeInputChange = (field: keyof ScrapeFormState, value: string | boolean) => {
  setScrapeForm((prev) => ({
   ...prev,
   [field]: value,
  }));
 };

 const handlePipelineInputChange = (field: keyof PipelineFormState, value: string | boolean) => {
  setPipelineForm((prev) => ({
   ...prev,
   [field]: value,
  }));
 };

 const triggerScrape = async () => {
  setScrapeLoading(true);
  setScrapeMessage(null);
  setScrapeRunning(true);
  try {
   const payload: ScrapeRequest = {
    use_pagination: scrapeForm.usePagination,
    delay: Number(scrapeForm.delay) || 1,
   };
   if (scrapeForm.year) payload.year = Number(scrapeForm.year);
   if (scrapeForm.month) payload.month = Number(scrapeForm.month);
   if (scrapeForm.day) payload.day = Number(scrapeForm.day);
   if (scrapeForm.maxPages) payload.max_pages = Number(scrapeForm.maxPages);
   if (scrapeForm.maxBulletins) payload.max_bulletins = Number(scrapeForm.maxBulletins);
   if (scrapeForm.maxSizeMb) payload.max_size_mb = Number(scrapeForm.maxSizeMb);
   if (scrapeForm.retries) payload.retries = Number(scrapeForm.retries);
   if (scrapeForm.backoff) payload.backoff = Number(scrapeForm.backoff);
   if (scrapeForm.connectTimeout) payload.connect_timeout = Number(scrapeForm.connectTimeout);
   if (scrapeForm.readTimeout) payload.read_timeout = Number(scrapeForm.readTimeout);
   if (!scrapeForm.verifySsl) payload.verify_ssl = false;
   const data = await triggerScrapeRequest(payload);
   const skipped = data.skipped ?? 0;
   setScrapeMessage({
    type: "success",
    text: `Telechargement termine : ${data.success}/${data.total} bulletins. ${skipped} ignores.`,
   });
   setRecentDownloads(Array.isArray(data.downloads) ? data.downloads : []);
   fetchManifest();
  } catch (error) {
   setScrapeMessage({
    type: "error",
    text: error instanceof Error ? error.message : "Erreur inattendue lors du scraping",
   });
  } finally {
   setScrapeRunning(false);
   setScrapeLoading(false);
  }
 };

 const fetchRuns = useCallback(async () => {
  setRunsLoading(true);
  setRunsError(null);
  try {
   const data = await fetchPipelineRuns();
   const items: PipelineRunSummary[] = Array.isArray(data.runs) ? data.runs.map(mapRunSummary) : [];
   setRuns(items);
   if (!selectedRunId && items.length > 0) {
    setSelectedRunId(items[0].id);
   } else if (selectedRunId && !items.some((run) => run.id === selectedRunId)) {
    setSelectedRunId(items[0]?.id ?? null);
   }
  } catch (error) {
   setRunsError(error instanceof Error ? error.message : "Erreur inattendue lors du chargement des runs");
  } finally {
   setRunsLoading(false);
  }
 }, [selectedRunId]);

 const fetchManifest = useCallback(async () => {
  setManifestLoading(true);
  setManifestError(null);
  try {
   const data = await fetchScrapeManifest();
   setManifestData(data);
  } catch (error) {
   setManifestError(error instanceof Error ? error.message : "Erreur lors du chargement du manifest");
  } finally {
   setManifestLoading(false);
  }
 }, []);
 
 const fetchDetail = useCallback(async (runId: number) => {
 	setDetailLoading(true);
 	try {
 		const data = await fetchPipelineRunDetail(runId);
 		setSelectedRun(mapRunDetail(data));
 	} catch (error: any) {
 		if (error?.name !== "AbortError") {
 			setSelectedRun(null);
 		}
 	} finally {
 		setDetailLoading(false);
 	}
 }, []);
 
 useEffect(() => {
  fetchManifest();
 }, [fetchManifest]);

 useEffect(() => {
  fetchRuns();
 }, [fetchRuns]);

 useEffect(() => {
  setPipelineRunning(runs[0]?.status === "running");
 }, [runs]);

 useEffect(() => {
 	if (!selectedRunId) {
 		setSelectedRun(null);
 		return;
 	}
 	fetchDetail(selectedRunId);
 	const interval = setInterval(() => fetchDetail(selectedRunId), 5000);
 	return () => clearInterval(interval);
 }, [selectedRunId, fetchDetail]);
 
 const triggerPipelineRun = async () => {
  setPipelineLoading(true);
  setPipelineMessage(null);
  setPipelineRunning(true);
  try {
   const payload: PipelineTriggerRequest = {
    use_scraping: pipelineForm.useScraping,
   };
   if (pipelineForm.year) payload.year = Number(pipelineForm.year);
   if (pipelineForm.month) payload.month = Number(pipelineForm.month);
   if (pipelineForm.day) payload.day = Number(pipelineForm.day);
   if (pipelineForm.maxBulletins) payload.max_bulletins = Number(pipelineForm.maxBulletins);
   const data = await triggerPipelineRunRequest(payload);
   setPipelineMessage({
    type: "success",
    text: `Pipeline lance (#${data.run_id})`,
   });
   setSelectedRunId(Number(data.run_id));
   fetchRuns();
  } catch (error) {
   setPipelineMessage({
    type: "error",
    text: error instanceof Error ? error.message : "Erreur inattendue lors du lancement du pipeline",
   });
   setPipelineRunning(false);
  } finally {
   setPipelineLoading(false);
  }
 };

 const handleStopPipeline = async (runId: number) => {
  if (!window.confirm("Êtes-vous sûr de vouloir arrêter ce pipeline ?")) return;
  try {
   await stopPipelineRun(runId);
   fetchRuns();
  } catch (err) {
   console.error("Erreur lors de l'arrêt du pipeline:", err);
  }
 };

 const handleSkipStep = async (runId: number, stepKey: string) => {
  try {
   await skipPipelineStep(runId, stepKey);
   if (selectedRunId === runId) {
    fetchDetail(runId);
   } else {
    fetchRuns();
   }
  } catch (err) {
   console.error("Erreur lors du saut de l'étape:", err);
  }
 };

 return (
   <Layout title="Pilotage du Pipeline">
     <div className="space-y-6">
       {/* Résumé du dernier run */}
       {latestRun && (
         <div className="bg-[var(--surface)] rounded-2xl border border-[var(--border)] shadow-lg p-4">
           <div className="flex items-center justify-between mb-4">
             <h3 className="text-lg font-bold text-ink">Dernier run</h3>
             {latestRun.status === "running" && (
               <button
                 onClick={() => handleStopPipeline(latestRun.id)}
                 className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-50 text-red-700 hover:bg-red-100 dark:bg-red-900/20 dark:text-red-400 transition-colors text-xs font-bold border border-red-200 dark:border-red-800"
               >
                 <span className="material-symbols-outlined text-sm">stop_circle</span>
                 Arrêter le pipeline
               </button>
             )}
           </div>
           <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
             <div>
               <p className="text-sm text-muted">Date</p>
               <p className="text-base font-medium text-ink">
                 {new Date(latestRun.startedAt).toLocaleString("fr-FR")}
               </p>
             </div>
             <div>
               <p className="text-sm text-muted">Statut</p>
               <span
                 className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${getStatusColor(latestRun.status)}`}
               >
                 <span className="material-symbols-outlined text-sm mr-1">
                   {getStatusIcon(latestRun.status)}
                 </span>
                 {getStatusLabel(latestRun.status)}
               </span>
             </div>
             <div>
               <p className="text-sm text-muted">Durée</p>
               <p className="text-base font-medium text-ink">
                 {formatDuration(getRunDuration(latestRun))}
               </p>
             </div>
             <div>
               <p className="text-sm text-muted">Notes</p>
               <p className="text-base font-medium text-ink flex items-center gap-2">
                 {Array.isArray(latestMetadata.notes) ? latestMetadata.notes.length : 0}
                 {Array.isArray(latestMetadata.notes) && latestMetadata.notes.length > 0 && (
                   <span className="text-yellow-600 dark:text-yellow-400">!</span>
                 )}
               </p>
             </div>
           </div>
         </div>
       )}

       {/* Lancement du pipeline complet */}
       <div className="bg-[var(--surface)] rounded-2xl border border-[var(--border)] shadow-lg p-6">
         <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
           <div>
             <h3 className="text-lg font-bold text-ink">Orchestrer le pipeline</h3>
             <p className="text-sm text-muted">
               Déclenchez l'ensemble des 7 modules avec les filtres souhaités. Le statut bascule
               automatiquement en direct.
             </p>
           </div>
           <button
             type="button"
             onClick={triggerPipelineRun}
             disabled={pipelineLoading}
             className="flex items-center gap-2 rounded-xl bg-gradient-to-br from-primary-500 to-secondary-600 text-white px-5 py-2 text-sm font-semibold shadow-lg hover:bg-primary/90 disabled:opacity-60 disabled:cursor-not-allowed"
           >
             <span className="material-symbols-outlined">
               {pipelineLoading ? "progress_activity" : "play_circle"}
             </span>
             {pipelineLoading ? "Pipeline en cours..." : "Lancer le pipeline"}
           </button>
         </div>
         <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
           <div>
             <label className="block text-sm font-medium text-ink mb-1">Année</label>
             <input
               type="number"
               min={2000}
               value={pipelineForm.year}
               onChange={(e) => handlePipelineInputChange("year", e.target.value)}
               className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface-strong)] px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-secondary"
             />
           </div>
           <div>
             <label className="block text-sm font-medium text-ink mb-1">Mois</label>
             <input
               type="number"
               min={1}
               max={12}
               value={pipelineForm.month}
               onChange={(e) => handlePipelineInputChange("month", e.target.value)}
               className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface-strong)] px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-secondary"
             />
           </div>
           <div>
             <label className="block text-sm font-medium text-ink mb-1">Jour</label>
             <input
               type="number"
               min={1}
               max={31}
               value={pipelineForm.day}
               onChange={(e) => handlePipelineInputChange("day", e.target.value)}
               className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface-strong)] px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-secondary"
             />
           </div>
           <div>
             <label className="block text-sm font-medium text-ink mb-1">Bulletins max</label>
             <input
               type="number"
               min={1}
               value={pipelineForm.maxBulletins}
               onChange={(e) => handlePipelineInputChange("maxBulletins", e.target.value)}
               className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface-strong)] px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-secondary"
             />
           </div>
         </div>
         <div className="flex items-center justify-between flex-wrap gap-4 mt-4">
           <label className="flex items-center gap-2 text-sm font-medium text-ink">
             <input
               type="checkbox"
               className="rounded border-[var(--border)] text-secondary focus:ring-secondary/50"
               checked={pipelineForm.useScraping}
               onChange={(e) => handlePipelineInputChange("useScraping", e.target.checked)}
             />
             Inclure la phase de scraping
           </label>
           {pipelineMessage && (
             <p
               className={`text-sm font-medium ${
                 pipelineMessage.type === "success"
                   ? "text-green-600 dark:text-green-400"
                   : "text-red-600 dark:text-red-400"
               }`}
             >
               {pipelineMessage.text}
             </p>
           )}
         </div>
       </div>

       {/* Lancement du scraping */}
       <div className="bg-[var(--surface)] rounded-2xl border border-[var(--border)] shadow-lg p-6">
         <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
           <div>
             <h3 className="text-lg font-bold text-ink">Lancer un scraping</h3>
             <p className="text-sm text-muted">
               Choisissez vos filtres (année, mois, jour) puis déclenchez le téléchargement des
               bulletins PDF.
             </p>
           </div>
           <label className="flex items-center gap-2 text-sm font-medium text-ink">
             <input
               type="checkbox"
               className="rounded border-[var(--border)] text-primary focus:ring-primary/50"
               checked={scrapeForm.usePagination}
               onChange={(e) => handleScrapeInputChange("usePagination", e.target.checked)}
             />
             Pagination automatique
           </label>
         </div>
         <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
           <div>
             <label className="block text-sm font-medium text-ink mb-1">Année</label>
             <input
               type="number"
               min={2000}
               placeholder="2025"
               value={scrapeForm.year}
               onChange={(e) => handleScrapeInputChange("year", e.target.value)}
               className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface-strong)] px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
             />
           </div>
           <div>
             <label className="block text-sm font-medium text-ink mb-1">Mois</label>
             <input
               type="number"
               min={1}
               max={12}
               placeholder="10"
               value={scrapeForm.month}
               onChange={(e) => handleScrapeInputChange("month", e.target.value)}
               className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface-strong)] px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
             />
           </div>
           <div>
             <label className="block text-sm font-medium text-ink mb-1">Jour</label>
             <input
               type="number"
               min={1}
               max={31}
               placeholder="15"
               value={scrapeForm.day}
               onChange={(e) => handleScrapeInputChange("day", e.target.value)}
               className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface-strong)] px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
             />
           </div>
           <div>
             <label className="block text-sm font-medium text-ink mb-1">Pages max</label>
             <input
               type="number"
               min={1}
               placeholder="5"
               value={scrapeForm.maxPages}
               onChange={(e) => handleScrapeInputChange("maxPages", e.target.value)}
               className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface-strong)] px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
             />
           </div>
           <div>
             <label className="block text-sm font-medium text-ink mb-1">Bulletins max</label>
             <input
               type="number"
               min={1}
               placeholder="50"
               value={scrapeForm.maxBulletins}
               onChange={(e) => handleScrapeInputChange("maxBulletins", e.target.value)}
               className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface-strong)] px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
             />
           </div>
           <div>
             <label className="block text-sm font-medium text-ink mb-1">Delai (s)</label>
             <input
               type="number"
               min={0}
               step={0.5}
               placeholder="1"
               value={scrapeForm.delay}
               onChange={(e) => handleScrapeInputChange("delay", e.target.value)}
               className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface-strong)] px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
             />
           </div>
         </div>
         <div className="mt-6 rounded-2xl border border-dashed border-[var(--border)] p-4">
           <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
             <p className="text-xs font-semibold uppercase tracking-[0.3em] text-muted">
               Options avancees
             </p>
             <button
               type="button"
               onClick={() => setShowAdvancedScrape((value) => !value)}
               className="rounded-full border border-[var(--border)] px-3 py-1 text-xs font-semibold text-ink hover:bg-[var(--surface-strong)] transition-colors"
             >
               {showAdvancedScrape ? "Masquer" : "Afficher"}
             </button>
           </div>
           {showAdvancedScrape && (
             <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
               <div>
                 <label className="block text-sm font-medium text-ink mb-1">Taille max (Mo)</label>
                 <input
                   type="number"
                   min={1}
                   placeholder="50"
                   value={scrapeForm.maxSizeMb}
                   onChange={(e) => handleScrapeInputChange("maxSizeMb", e.target.value)}
                   className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface-strong)] px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                 />
               </div>
               <div>
                 <label className="block text-sm font-medium text-ink mb-1">Tentatives</label>
                 <input
                   type="number"
                   min={0}
                   placeholder="3"
                   value={scrapeForm.retries}
                   onChange={(e) => handleScrapeInputChange("retries", e.target.value)}
                   className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface-strong)] px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                 />
               </div>
               <div>
                 <label className="block text-sm font-medium text-ink mb-1">Délai croissant</label>
                 <input
                   type="number"
                   min={0}
                   step={0.1}
                   placeholder="0.5"
                   value={scrapeForm.backoff}
                   onChange={(e) => handleScrapeInputChange("backoff", e.target.value)}
                   className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface-strong)] px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                 />
               </div>
               <div>
                 <label className="block text-sm font-medium text-ink mb-1">
                   Délai de connexion (s)
                 </label>
                 <input
                   type="number"
                   min={1}
                   step={1}
                   placeholder="10"
                   value={scrapeForm.connectTimeout}
                   onChange={(e) => handleScrapeInputChange("connectTimeout", e.target.value)}
                   className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface-strong)] px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                 />
               </div>
               <div>
                 <label className="block text-sm font-medium text-ink mb-1">
                   Délai de lecture (s)
                 </label>
                 <input
                   type="number"
                   min={1}
                   step={1}
                   placeholder="30"
                   value={scrapeForm.readTimeout}
                   onChange={(e) => handleScrapeInputChange("readTimeout", e.target.value)}
                   className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface-strong)] px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                 />
               </div>
               <div className="flex items-end">
                 <label className="flex items-center gap-2 text-sm font-medium text-ink">
                   <input
                     type="checkbox"
                     className="rounded border-[var(--border)] text-primary focus:ring-primary/50"
                     checked={scrapeForm.verifySsl}
                     onChange={(e) => handleScrapeInputChange("verifySsl", e.target.checked)}
                   />
                   Vérifier SSL
                 </label>
               </div>
             </div>
           )}
         </div>
         <div className="flex flex-wrap items-center gap-4 pt-4">
           <button
             type="button"
             onClick={triggerScrape}
             disabled={scrapeLoading}
             className="flex items-center gap-2 rounded-xl bg-gradient-to-br from-primary-500 to-secondary-600 text-white px-5 py-2 text-sm font-semibold shadow-lg hover:bg-primary/90 disabled:opacity-60 disabled:cursor-not-allowed"
           >
             <span className="material-symbols-outlined">
               {scrapeLoading ? "hourglass_top" : "cloud_download"}
             </span>
             {scrapeLoading ? "Scraping en cours..." : "Lancer le scraping"}
           </button>
           {scrapeMessage && (
             <p
               className={`text-sm font-medium ${
                 scrapeMessage.type === "success"
                   ? "text-green-600 dark:text-green-400"
                   : "text-red-600 dark:text-red-400"
               }`}
             >
               {scrapeMessage.text}
             </p>
           )}
         </div>
         {recentDownloads.length > 0 && (
           <div className="mt-4 rounded-xl border border-[var(--border)] bg-[var(--surface-strong)] p-4">
             <p className="text-sm font-semibold text-ink mb-2">Derniers fichiers téléchargés</p>
             <ul className="text-sm text-ink space-y-1">
               {recentDownloads.slice(0, 5).map((file, idx) => (
                 <li
                   key={`${file.path}-${idx}`}
                   className="flex items-center justify-between gap-2"
                 >
                   <span className="truncate">
                     {file.title || "Bulletin"} —{" "}
                     <span className="text-xs text-muted">{file.path}</span>
                     {file.status && (
                       <span className="ml-2 text-[10px] uppercase tracking-[0.2em] text-muted">
                         {file.status}
                       </span>
                     )}
                   </span>
                   {file.url && (
                     <a
                       href={file.url}
                       target="_blank"
                       rel="noopener noreferrer"
                       className="text-primary hover:underline text-xs font-medium"
                     >
                       Ouvrir
                     </a>
                   )}
                 </li>
               ))}
             </ul>
           </div>
         )}
       </div>

       {/* Manifest scraping */}
       <div className="bg-[var(--surface)] rounded-2xl border border-[var(--border)] shadow-lg p-6">
         <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
           <div>
             <h3 className="text-lg font-bold text-ink">Manifest scraping</h3>
             <p className="text-sm text-muted">
               Suivi des bulletins déjà téléchargés et dédupliqués.
             </p>
           </div>
           <button
             type="button"
             onClick={fetchManifest}
             disabled={manifestLoading}
             className="flex items-center gap-2 rounded-xl border border-[var(--border)] px-4 py-2 text-sm font-semibold text-ink hover:bg-[var(--surface-strong)] disabled:opacity-60"
           >
             <span className="material-symbols-outlined text-sm">
               {manifestLoading ? "progress_activity" : "refresh"}
             </span>
             {manifestLoading ? "Chargement..." : "Rafraîchir"}
           </button>
         </div>
         {manifestError && (
           <p className="text-sm font-medium text-red-600 dark:text-red-400">{manifestError}</p>
         )}
         <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
           <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-strong)] p-3">
             <p className="text-xs text-muted">Éléments</p>
             <p className="text-sm font-semibold text-ink">{manifestEntries.length}</p>
           </div>
           <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-strong)] p-3">
             <p className="text-xs text-muted">Manifest</p>
             <p className="text-sm font-semibold text-ink">
               {manifestData?.exists ? "Disponible" : "Absent"}
             </p>
           </div>
           <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-strong)] p-3">
             <p className="text-xs text-muted">Répertoire de sortie</p>
             <p className="text-xs font-medium text-ink truncate">
               {manifestData?.output_dir ?? "--"}
             </p>
           </div>
         </div>
         {manifestEntries.length === 0 ? (
           <div className="rounded-xl border border-dashed border-[var(--border)] bg-[var(--surface-strong)] p-4 text-sm text-muted">
             Aucun enregistrement disponible pour le moment.
           </div>
         ) : (
           <div className="overflow-x-auto">
             <table className="min-w-full text-sm">
               <thead className="text-xs uppercase tracking-[0.2em] text-muted">
                 <tr>
                   <th className="px-3 py-2 text-left">Date</th>
                   <th className="px-3 py-2 text-left">Titre</th>
                   <th className="px-3 py-2 text-left">Fichier</th>
                   <th className="px-3 py-2 text-right">Taille</th>
                 </tr>
               </thead>
               <tbody className="divide-y divide-[var(--border)]">
                 {manifestEntries.slice(0, 8).map((entry, idx) => {
                   const filename = entry.filename || entry.path?.split(/[/\\\\]/).pop() || "--";
                   const dateLabel = entry.downloaded_at
                     ? new Date(entry.downloaded_at).toLocaleString("fr-FR")
                     : "--";
                   return (
                     <tr key={`${entry.sha256 ?? entry.url ?? idx}`}>
                       <td className="px-3 py-2 text-muted">{dateLabel}</td>
                       <td className="px-3 py-2 text-ink">{entry.title || "Bulletin"}</td>
                       <td className="px-3 py-2 text-muted">{filename}</td>
                       <td className="px-3 py-2 text-right text-muted">
                         {formatBytes(entry.size)}
                       </td>
                     </tr>
                   );
                 })}
               </tbody>
             </table>
           </div>
         )}
       </div>

       {/* Liste des runs */}
       <div className="bg-[var(--surface)] rounded-2xl border border-[var(--border)] shadow-lg">
         <div className="px-4 py-3 border-b border-[var(--border)] bg-[var(--surface-strong)]">
           <h3 className="text-lg font-bold text-ink">Historique des runs</h3>
         </div>
         <div className="p-4 space-y-2">
           {runsError && (
             <p className="text-sm font-medium text-red-600 dark:text-red-400">{runsError}</p>
           )}
           {runsLoading && (
             <p className="text-xs text-muted flex items-center gap-2">
               <span className="material-symbols-outlined text-sm animate-spin">
                 progress_activity
               </span>
               Chargement des runs...
             </p>
           )}
           {runs.map((run) => (
             <div
               key={run.id}
               onClick={() => setSelectedRunId(run.id)}
               className={`p-4 border rounded-2xl cursor-pointer transition-colors ${
                 selectedRunId === run.id
                   ? "border-primary bg-primary/5"
                   : "border-[var(--border)] hover:bg-[var(--surface-strong)] "
               }`}
             >
               <div className="flex items-center justify-between">
                 <div className="flex items-center gap-3">
                   <span className="material-symbols-outlined text-muted">
                     {getStatusIcon(run.status)}
                   </span>
                   <div>
                     <p className="text-sm font-medium text-ink">
                       {new Date(run.startedAt).toLocaleString("fr-FR")}
                     </p>
                     <p className="text-xs text-muted">
                       {getBulletinsCount(run)} bulletins traités
                     </p>
                   </div>
                 </div>
                 <div className="flex items-center gap-4">
                   <span className={`text-xs px-2 py-1 rounded ${getStatusColor(run.status)}`}>
                     {getStatusLabel(run.status)}
                   </span>
                   <span className="text-sm text-muted">{formatDuration(getRunDuration(run))}</span>
                   {getNotesCount(run) > 0 && (
                     <span className="text-sm text-yellow-600 dark:text-yellow-400">
                       {getNotesCount(run)} alerte{getNotesCount(run) > 1 ? "s" : ""}
                     </span>
                   )}
                 </div>
               </div>
             </div>
           ))}
         </div>
       </div>

       {/* Détails du run sélectionné */}
       {selectedRun && (
         <div className="bg-[var(--surface)] rounded-2xl border border-[var(--border)] shadow-lg">
           <div className="px-4 py-3 border-b border-[var(--border)] bg-[var(--surface-strong)] flex flex-wrap items-center justify-between gap-2">
             <h3 className="text-lg font-bold text-ink">
               Détails du run – {new Date(selectedRun.startedAt).toLocaleString("fr-FR")}
             </h3>
             {detailLoading && (
               <span className="text-xs text-muted flex items-center gap-1">
                 <span className="material-symbols-outlined text-sm animate-spin">
                   progress_activity
                 </span>
                 Rafraîchissement...
               </span>
             )}
           </div>
           <div className="p-4 space-y-4">
             {selectedRun.steps.map((step, idx) => (
               <div
                 key={step.key || idx}
                 className="border border-[var(--border)] rounded-2xl p-4 space-y-3"
               >
                 <div className="flex items-center justify-between">
                   <div className="flex items-center gap-3">
                     <span className="material-symbols-outlined text-muted">
                       {stepIcons[step.key] || "settings"}
                     </span>
                     <h4 className="text-base font-semibold text-ink">
                       {step.label || stepLabels[step.key] || step.key}
                     </h4>
                   </div>
                   <div className="flex items-center gap-3">
                     {step.duration && (
                       <span className="text-sm text-muted">{formatDuration(step.duration)}</span>
                     )}
                     <span
                       className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${getStatusColor(step.status)}`}
                     >
                       <span className="material-symbols-outlined text-sm mr-1">
                         {getStatusIcon(step.status)}
                       </span>
                       {step.status === "success"
                         ? "Succès"
                         : step.status === "running"
                           ? "En cours"
                           : step.status === "error"
                             ? "Erreur"
                             : step.status === "skipped"
                               ? "Sauté"
                               : "En attente"}
                     </span>
                     {step.status === "pending" && selectedRun.status === "running" && (
                       <button
                         onClick={() => handleSkipStep(selectedRun.id, step.key)}
                         className="flex items-center gap-1 px-2 py-1 rounded bg-amber-50 text-amber-700 hover:bg-amber-100 dark:bg-amber-900/20 dark:text-amber-400 transition-colors text-[10px] font-bold border border-amber-200 dark:border-amber-800"
                       >
                         <span className="material-symbols-outlined text-xs">fast_forward</span>
                         Sauter
                       </button>
                     )}
                   </div>
                 </div>
                 {step.startTime && (
                   <div className="text-xs text-muted">
                     Début: {new Date(step.startTime).toLocaleTimeString("fr-FR")}
                     {step.endTime &&
                       ` — Fin: ${new Date(step.endTime).toLocaleTimeString("fr-FR")}`}
                   </div>
                 )}
                 {step.message && <p className="text-xs text-ink">{step.message}</p>}
                 {step.errors && step.errors.length > 0 && (
                   <div className="mt-2 p-2 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded">
                     <p className="text-xs font-semibold text-red-800 dark:text-red-300 mb-1">
                       Erreurs:
                     </p>
                     <ul className="list-disc list-inside text-xs text-red-700 dark:text-red-400">
                       {step.errors.map((error, errIdx) => (
                         <li key={errIdx}>{error}</li>
                       ))}
                     </ul>
                   </div>
                 )}
                 {step.warnings && step.warnings.length > 0 && (
                   <div className="mt-2 p-2 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded">
                     <p className="text-xs font-semibold text-yellow-800 dark:text-yellow-300 mb-1">
                       Avertissements:
                     </p>
                     <ul className="list-disc list-inside text-xs text-yellow-700 dark:text-yellow-400">
                       {step.warnings.map((warning, warnIdx) => (
                         <li key={warnIdx}>{warning}</li>
                       ))}
                     </ul>
                   </div>
                 )}
               </div>
             ))}
           </div>
         </div>
       )}

       {/* Liens vers documentation */}
       <div className="bg-[var(--surface)] rounded-2xl border border-[var(--border)] shadow-lg p-4">
         <h3 className="text-lg font-bold text-ink mb-4">Ressources</h3>
         <div className="space-y-2">
           <a
             href="/README.md"
             target="_blank"
             rel="noopener noreferrer"
             className="flex items-center gap-2 text-primary hover:text-primary/80 transition-colors"
           >
             <span className="material-symbols-outlined">description</span>
             <span>Documentation / README</span>
           </a>
           <a
             href="#"
             target="_blank"
             rel="noopener noreferrer"
             className="flex items-center gap-2 text-primary hover:text-primary/80 transition-colors"
           >
             <span className="material-symbols-outlined">videocam</span>
             <span>Vidéo de démonstration</span>
           </a>
         </div>
       </div>
     </div>
   </Layout>
 );
}

