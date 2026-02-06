import { useEffect, useState } from "react";
import { Layout } from "../components/Layout";
import { API_BASE_URL, UPLOAD_BATCH_MAX_FILES } from "../config";
import { finishRequest, reportError, startRequest } from "../services/statusStore";
import {
 fetchUploadBatchStatus,
 stopUploadBatch,
 uploadBulletinsBatch,
 type UploadBatchStatus,
} from "../services/api";

type TemperatureValue = {
 name?: string | null;
 tmin: number | null;
 tmax: number | null;
 tmin_raw?: string | null;
 tmax_raw?: string | null;
 bbox?: [number, number, number, number] | null;
 map_width?: number | null;
 map_height?: number | null;
};

type MapTemperatures = {
  type?: string;
  image_path?: string | null;
  temperatures: TemperatureValue[];
};

type TemperatureExtraction = {
 pdf_path: string | null;
 image_path: string | null;
 data: MapTemperatures[];
};

type UploadResponse = {
 filename: string;
 pdf_path: string;
 temperatures: TemperatureExtraction[];
};

function OCRVisualizer({ 
  imagePath, 
  detections, 
  title 
}: { 
  imagePath: string; 
  detections: TemperatureValue[]; 
  title?: string 
}) {
  const imageUrl = `${API_BASE_URL}/files/pdf_images/${imagePath}`;
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-ink">{title || "Visualisation OCR"}</p>
        <span className="text-xs text-muted">{detections.length} détections</span>
      </div>
      
      <div className="relative border border-[var(--border)] rounded-xl overflow-hidden bg-black/5">
        <img 
          src={imageUrl} 
          alt="Carte Météo" 
          className="w-full h-auto block"
        />
        <svg 
          className="absolute top-0 left-0 w-full h-full pointer-events-none" 
          viewBox="0 0 100 100" 
          preserveAspectRatio="none"
          style={{ width: '100%', height: '100%' }}
        >
          {/* Les bboxes sont en pixels, on doit les convertir en % ou utiliser le viewBox de l'image réelle */}
          {/* Pour simplifier, on va injecter les bboxes directement si on connaît la taille de l'image, 
              sinon on utilise un wrapper avec position absolute sur les divs */}
        </svg>
        
        {/* Approche par DIVs absolues (plus simple sans connaître la résolution native à l'avance) */}
        <div className="absolute top-0 left-0 w-full h-full overflow-hidden">
          {detections.map((det, idx) => {
            if (!det.bbox) return null;
            // Note: Les bboxes sont extraites sur l'image recadrée (map), 
            // donc elles sont relatives au coin haut-gauche de l'image passée ici.
            // On suppose que l'image affichée est l'image exacte sur laquelle l'OCR a tourné.
            // Malheureusement, on n'a pas la taille W/H native ici pour faire des % propres.
            // On va utiliser un pattern SVG avec viewBox basé sur l'image si possible, 
            // ou alors on demande au navigateur la taille naturelle.
            return (
              <OCRBox 
                key={idx} 
                bbox={det.bbox} 
                label={det.name || `D${idx+1}`}
                isHovered={hoveredIndex === idx}
                onHover={() => setHoveredIndex(idx)}
                onLeave={() => setHoveredIndex(null)}
                mapWidth={det.map_width}
                mapHeight={det.map_height}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}

function OCRBox({ 
  bbox, 
  label, 
  isHovered,
  onHover,
  onLeave,
  mapWidth,
  mapHeight
}: { 
  bbox: [number, number, number, number]; 
  label: string;
  isHovered: boolean;
  onHover: () => void;
  onLeave: () => void;
  mapWidth?: number | null;
  mapHeight?: number | null;
}) {
  if (!mapWidth || !mapHeight) return null;

  const [x, y, w, h] = bbox;
  const left = (x / mapWidth) * 100;
  const top = (y / mapHeight) * 100;
  const width = (w / mapWidth) * 100;
  const height = (h / mapHeight) * 100;

  return (
    <div 
      className={`absolute border-2 transition-all cursor-help ${
        isHovered 
          ? "border-yellow-400 bg-yellow-400/20 z-20 scale-110" 
          : "border-primary/60 bg-primary/5 z-10"
      }`}
      style={{
        left: `${left}%`,
        top: `${top}%`,
        width: `${width}%`,
        height: `${height}%`,
      }}
      onMouseEnter={onHover}
      onMouseLeave={onLeave}
      title={label}
    >
      <span className={`absolute -top-5 left-0 px-1 py-0.5 text-[10px] font-bold rounded ${
        isHovered ? "bg-yellow-400 text-black" : "bg-primary text-white"
      }`}>
        {label}
      </span>
    </div>
  );
}

export function UploadBulletinPage() {
 const [selectedFile, setSelectedFile] = useState<File | null>(null);
 const [uploading, setUploading] = useState(false);
 const [error, setError] = useState<string | null>(null);
 const [result, setResult] = useState<UploadResponse | null>(null);
 const [batchFiles, setBatchFiles] = useState<File[]>([]);
 const [batchId, setBatchId] = useState<string | null>(null);
 const [batchStatus, setBatchStatus] = useState<UploadBatchStatus | null>(null);
 const [batchLoading, setBatchLoading] = useState(false);
 const [batchError, setBatchError] = useState<string | null>(null);

 const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
 if (e.target.files && e.target.files[0]) {
  setSelectedFile(e.target.files[0]);
  setResult(null);
  setError(null);
 }
 };

 const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
 e.preventDefault();
 if (e.dataTransfer.files && e.dataTransfer.files[0]) {
  setSelectedFile(e.dataTransfer.files[0]);
  setResult(null);
  setError(null);
 }
 };

 const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
 e.preventDefault();
 };

 const handleBatchFiles = (files: FileList | null) => {
 if (!files) return;
 const next = Array.from(files);
 if (UPLOAD_BATCH_MAX_FILES > 0 && next.length > UPLOAD_BATCH_MAX_FILES) {
  const message = `Limite atteinte: ${UPLOAD_BATCH_MAX_FILES} fichiers maximum.`;
  setBatchError(message);
  reportError(message);
  setBatchFiles(next.slice(0, UPLOAD_BATCH_MAX_FILES));
 } else {
  setBatchFiles(next);
  setBatchError(null);
 }
 setBatchStatus(null);
 setBatchId(null);
 };

 const handleBatchDrop = (e: React.DragEvent<HTMLDivElement>) => {
 e.preventDefault();
 handleBatchFiles(e.dataTransfer.files);
 };

 const handleUpload = async () => {
 if (!selectedFile) return;
 setUploading(true);
 setError(null);
 setResult(null);

 const formData = new FormData();
 formData.append("file", selectedFile);

 try {
  startRequest();
  const response = await fetch(`${API_BASE_URL}/upload-bulletin`, {
  method: "POST",
  body: formData,
  });
  const data = await response.json();
  if (!response.ok) {
  const message =
   typeof data.detail === "string" ? data.detail : "Echec du traitement du bulletin.";
  reportError(message);
  throw new Error(message);
  }
  setResult(data);
 } catch (err) {
  const message = err instanceof Error ? err.message : "Erreur inattendue lors de l'upload.";
  reportError(message);
  setError(message);
 } finally {
  finishRequest();
  setUploading(false);
 }
 };

 const handleBatchUpload = async () => {
 if (batchFiles.length === 0) return;
 setBatchLoading(true);
 setBatchError(null);
 try {
  const response = await uploadBulletinsBatch(batchFiles);
  setBatchId(response.batch_id);
  setBatchStatus({
  batch_id: response.batch_id,
  status: "pending",
  total: response.total,
  pending: response.total,
  running: 0,
  success: 0,
  error: 0,
  canceled: 0,
  jobs: response.jobs.map((job) => ({
   job_id: job.job_id,
   status: job.status,
   filename: job.filename,
   pdf_path: job.pdf_path,
  })),
  });
 } catch (err) {
  const message =
  err instanceof Error ? err.message : "Erreur inattendue lors de l'upload en masse.";
  setBatchError(message);
  reportError(message);
 } finally {
  setBatchLoading(false);
 }
 };

 const handleStopBatch = async () => {
 if (!batchId) return;
 try {
  await stopUploadBatch(batchId);
  const data = await fetchUploadBatchStatus(batchId);
  setBatchStatus(data);
 } catch (err) {
  const message =
  err instanceof Error ? err.message : "Impossible d'arreter le batch.";
  setBatchError(message);
  reportError(message);
 }
 };

 useEffect(() => {
 if (!batchId) return;
 let isMounted = true;
 const refresh = async () => {
  try {
  const data = await fetchUploadBatchStatus(batchId);
  if (isMounted) {
   setBatchStatus(data);
   if (["success", "error", "partial", "canceled"].includes(data.status)) {
   clearInterval(interval);
   }
  }
  } catch (err) {
  if (isMounted) {
   setBatchError("Impossible de recuperer l'etat du batch.");
  }
  }
 };
 refresh();
 const interval = setInterval(refresh, 5000);
 return () => {
  isMounted = false;
  clearInterval(interval);
 };
 }, [batchId]);

 const computeEta = (status: UploadBatchStatus) => {
 const completed = status.jobs.filter(
  (job) => job.status === "success" || job.status === "error" || job.status === "canceled"
 );
 const durations = completed
  .map((job) => {
  if (!job.created_at || !job.updated_at) return null;
  const start = new Date(job.created_at.replace(" ", "T")).getTime();
  const end = new Date(job.updated_at.replace(" ", "T")).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  const diff = end - start;
  return diff > 0 ? diff : null;
  })
  .filter((value): value is number => value !== null);
 if (durations.length === 0) return null;
 const avg = durations.reduce((sum, value) => sum + value, 0) / durations.length;
 const remaining = status.total - completed.length;
 if (remaining <= 0) return null;
 const etaMs = avg * remaining;
 const minutes = Math.floor(etaMs / 60000);
 const seconds = Math.round((etaMs % 60000) / 1000);
 return `${minutes}m ${seconds}s`;
 };

 const renderTemperatures = () => {
 if (!result || result.temperatures.length === 0) {
  return (
  <p className="text-sm text-muted">
   Aucune température détectée pour le moment. Importez un bulletin pour lancer le traitement.
  </p>
  );
 }

 return result.temperatures.map((entry, index) => (
  <div
  key={`${entry.pdf_path}-${index}`}
  className="rounded-2xl border border-[var(--border)] p-4 sm:p-6 bg-[var(--surface)] shadow-sm"
  >
  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
   <div className="space-y-1">
   <p className="text-sm text-muted">PDF</p>
   <p className="text-sm font-medium text-ink break-all">{entry.pdf_path}</p>
   </div>
   <div className="space-y-1">
   <p className="text-sm text-muted">Image principale</p>
   <p className="text-sm font-medium text-ink break-all">{entry.image_path}</p>
   </div>
  </div>
  <div className="mt-4 space-y-5">
   {entry.data.map((mapEntry, idx) => (
   <div key={`${mapEntry.type}-${idx}`}>
    <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
    <p className="text-sm font-semibold text-ink">
     Carte : {mapEntry.type ?? "Inconnue"}
    </p>
    <span className="text-xs font-medium text-muted">
     {mapEntry.temperatures.length} valeur(s)
    </span>
    </div>
    {mapEntry.temperatures.length === 0 ? (
    <p className="text-xs text-muted">Aucune valeur détectée.</p>
    ) : (
    <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
     <div className="order-2 xl:order-1 overflow-x-auto rounded-lg border border-[var(--border)]">
      <table className="min-w-full divide-y divide-[var(--border)] text-sm">
      <thead className="bg-[var(--surface-strong)]">
       <tr>
       <th className="px-3 py-2 text-left font-medium text-muted">Station</th>
       <th className="px-3 py-2 text-left font-medium text-muted">Tmin</th>
       <th className="px-3 py-2 text-left font-medium text-muted">Tmax</th>
       </tr>
      </thead>
      <tbody className="divide-y divide-[var(--border)]">
       {mapEntry.temperatures.map((temp, tempIdx) => (
       <tr key={`${temp.name}-${tempIdx}`}>
        <td className="px-3 py-2 text-ink">
        {temp.name ?? `Détection ${tempIdx + 1}`}
        </td>
        <td className="px-3 py-2 text-ink">
        {temp.tmin ?? temp.tmin_raw ?? "-"}
        </td>
        <td className="px-3 py-2 text-ink">
        {temp.tmax ?? temp.tmax_raw ?? "-"}
        </td>
       </tr>
       ))}
      </tbody>
      </table>
     </div>
     <div className="order-1 xl:order-2">
      <OCRVisualizer 
        imagePath={mapEntry.image_path || entry.image_path || ""} 
        detections={mapEntry.temperatures}
        title={`Zones OCR - ${mapEntry.type}`}
      />
     </div>
    </div>
    )}
   </div>
   ))}
  </div>
  </div>
 ));
 };

 const totalMaps =
 result?.temperatures.reduce((sum, entry) => sum + entry.data.length, 0) ?? 0;
 const totalValues =
 result?.temperatures.reduce(
  (sum, entry) =>
  sum + entry.data.reduce((mapSum, map) => mapSum + map.temperatures.length, 0),
  0
 ) ?? 0;

 return (
   <Layout title="Importer un bulletin météo">
     <div className="max-w-7xl mx-auto space-y-8">
       <div className="flex flex-col gap-2">
         <h1 className="text-ink text-4xl font-black leading-tight tracking-[-0.033em]">
           Importer un bulletin météo
         </h1>
         <p className="text-cloudy-600 dark:text-cloudy-300 text-base leading-normal">
           Glissez-déposez un fichier PDF ici ou cliquez pour sélectionner.
         </p>
       </div>

       <div className="space-y-6">
         <div
           className={`flex flex-col items-center gap-6 rounded-xl border-2 border-dashed px-6 py-14 bg-[var(--surface)] transition-all ${
             selectedFile
               ? "border-primary bg-cloudy-50 dark:bg-cloudy-900/20"
               : "border-cloudy-300 dark:border-cloudy-600 hover:border-primary"
           }`}
           onDrop={handleDrop}
           onDragOver={handleDragOver}
         >
           <span className="material-symbols-outlined text-primary text-5xl">cloud_upload</span>
           <div className="flex max-w-[480px] flex-col items-center gap-2">
             <p className="text-ink text-lg font-bold leading-tight tracking-[-0.015em] text-center">
               {selectedFile
                 ? `Fichier sélectionné : ${selectedFile.name}`
                 : "Glissez-déposez un fichier PDF ici"}
             </p>
             <p className="text-cloudy-600 dark:text-cloudy-300 text-sm leading-normal text-center">
               ou cliquez sur le bouton pour sélectionner un fichier depuis votre appareil.
             </p>
           </div>
           <label className="flex min-w-[84px] max-w-[480px] cursor-pointer items-center justify-center overflow-hidden rounded-lg h-10 px-4 bg-cloudy-200 dark:bg-[var(--surface-strong)] text-ink text-sm font-bold tracking-[0.015em] hover:bg-cloudy-300 dark:hover:bg-[var(--canvas-strong)] transition-colors shadow-sm">
             <input type="file" accept=".pdf" onChange={handleFileChange} className="hidden" />
             <span className="truncate">Sélectionner un fichier</span>
           </label>
         </div>

         <div className="flex justify-start">
           <button
             type="button"
             onClick={handleUpload}
             className="flex min-w-[84px] items-center justify-center rounded-lg h-12 px-5 bg-gradient-to-br from-primary-500 to-secondary-600 text-white text-base font-bold tracking-[0.015em] hover:opacity-90 transition-opacity gap-2 shadow-md disabled:opacity-50 disabled:cursor-not-allowed"
             disabled={!selectedFile || uploading}
           >
             <span className="material-symbols-outlined">
               {uploading ? "hourglass_top" : "rocket_launch"}
             </span>
             <span className="truncate">
               {uploading ? "Extraction en cours..." : "Lancer l'extraction"}
             </span>
           </button>
         </div>
       </div>

       <section className="space-y-4">
         <div className="flex flex-wrap items-center justify-between gap-3">
           <div>
             <h2 className="text-ink text-2xl font-bold">Import en masse</h2>
             <p className="text-sm text-cloudy-600 dark:text-cloudy-300">
               Uploadez plusieurs PDF, un ZIP ou un dossier complet.
             </p>
           </div>
           <button
             type="button"
             onClick={() => {
               setBatchFiles([]);
               setBatchId(null);
               setBatchStatus(null);
               setBatchError(null);
             }}
             className="rounded-full border border-[var(--border)] px-4 py-2 text-xs font-semibold text-ink hover:bg-[var(--canvas-strong)] transition-colors"
           >
             Reinitialiser
           </button>
         </div>

         <div
           className="rounded-2xl border border-dashed border-[var(--border)] p-6 bg-[var(--surface)]/70 "
           onDrop={handleBatchDrop}
           onDragOver={handleDragOver}
         >
           <div className="grid gap-4 md:grid-cols-[2fr,1fr] items-center">
             <div>
               <p className="text-sm font-semibold text-ink">Glissez-deposez des PDF ou un ZIP.</p>
               <p className="text-xs text-muted">
                 {batchFiles.length > 0
                   ? `${batchFiles.length} fichier(s) selectionne(s)`
                   : "Aucun fichier selectionne"}
               </p>
             </div>
             <div className="flex flex-wrap gap-2 justify-end">
               <label className="rounded-full border border-[var(--border)] px-4 py-2 text-xs font-semibold text-ink hover:bg-[var(--canvas-strong)] transition-colors cursor-pointer">
                 Fichiers
                 <input
                   type="file"
                   multiple
                   accept=".pdf,.zip"
                   className="hidden"
                   onChange={(e) => handleBatchFiles(e.target.files)}
                 />
               </label>
               <label className="rounded-full border border-[var(--border)] px-4 py-2 text-xs font-semibold text-ink hover:bg-[var(--canvas-strong)] transition-colors cursor-pointer">
                 Dossier
                 <input
                   type="file"
                   // @ts-expect-error - webkitdirectory is supported in Chromium browsers
                   webkitdirectory="true"
                   directory=""
                   multiple
                   className="hidden"
                   onChange={(e) => handleBatchFiles(e.target.files)}
                 />
               </label>
               <button
                 type="button"
                 onClick={handleBatchUpload}
                 disabled={batchFiles.length === 0 || batchLoading}
                 className="rounded-full bg-primary px-4 py-2 text-xs font-semibold text-white hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
               >
                 {batchLoading ? "Envoi..." : "Lancer le batch"}
               </button>
             </div>
           </div>
         </div>

         {batchError && (
           <div className="rounded-lg border border-red-200 bg-red-50 dark:border-red-900/50 dark:bg-red-900/20 p-4 text-sm text-red-700 dark:text-red-300">
             {batchError}
           </div>
         )}

         {batchStatus && (
           <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)]/70 p-4 space-y-3">
             <div className="flex flex-wrap items-center justify-between gap-2">
               <div>
                 <p className="text-xs text-muted uppercase tracking-[0.3em]">Batch</p>
                 <p className="text-sm font-semibold text-ink">{batchStatus.batch_id}</p>
               </div>
               <div className="text-xs font-semibold text-ink space-y-1 text-right">
                 <div>
                   {batchStatus.success}/{batchStatus.total} termine
                 </div>
                 {batchStatus.status === "running" && (
                   <div className="text-muted">ETA {computeEta(batchStatus) ?? "--"}</div>
                 )}
               </div>
             </div>
             <div className="h-2 w-full rounded-full bg-[var(--canvas-strong)]">
               <div
                 className="h-2 rounded-full bg-emerald-500"
                 style={{
                   width: `${Math.round((batchStatus.success / Math.max(1, batchStatus.total)) * 100)}%`,
                 }}
               />
             </div>
             <div className="grid gap-2 sm:grid-cols-5 text-xs text-muted">
               <div>En attente: {batchStatus.pending}</div>
               <div>En cours: {batchStatus.running}</div>
               <div>OK: {batchStatus.success}</div>
               <div>Erreur: {batchStatus.error}</div>
               <div>Annule: {batchStatus.canceled}</div>
             </div>
             {batchStatus.status === "running" && (
               <div>
                 <button
                   type="button"
                   onClick={handleStopBatch}
                   className="rounded-full border border-red-200 px-4 py-2 text-xs font-semibold text-red-600 hover:bg-red-50 transition-colors"
                 >
                   Stopper le batch
                 </button>
               </div>
             )}
             <div className="max-h-[260px] overflow-y-auto pr-2 text-xs">
               <table className="w-full text-left">
                 <thead className="text-muted">
                   <tr>
                     <th className="py-1">Fichier</th>
                     <th className="py-1">Statut</th>
                     <th className="py-1">Erreur</th>
                   </tr>
                 </thead>
                 <tbody>
                   {batchStatus.jobs.map((job) => (
                     <tr key={job.job_id} className="border-t border-[var(--border)]">
                       <td className="py-1 text-ink">{job.filename ?? job.job_id}</td>
                       <td className="py-1 text-ink">{job.status}</td>
                       <td className="py-1 text-red-600">{job.error_message ?? "--"}</td>
                     </tr>
                   ))}
                 </tbody>
               </table>
             </div>
           </div>
         )}
       </section>

       {result && (
         <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
           <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
             <p className="text-xs uppercase tracking-wide text-muted">Cartes détectées</p>
             <p className="mt-1 text-2xl font-bold text-ink">{totalMaps}</p>
           </div>
           <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
             <p className="text-xs uppercase tracking-wide text-muted">Valeurs Tmin/Tmax</p>
             <p className="mt-1 text-2xl font-bold text-ink">{totalValues}</p>
           </div>
           <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
             <p className="text-xs uppercase tracking-wide text-muted">Nom du fichier</p>
             <p className="mt-1 text-sm font-medium text-ink break-all">{result.filename}</p>
           </div>
         </div>
       )}

       {error && (
         <div className="rounded-lg border border-red-200 bg-red-50 dark:border-red-900/50 dark:bg-red-900/20 p-4 text-sm text-red-700 dark:text-red-300">
           {error}
         </div>
       )}

       <div className="space-y-4">
         <div className="flex flex-wrap justify-between items-center gap-4 pt-5">
           <h2 className="text-ink text-[22px] font-bold leading-tight tracking-[-0.015em]">
             Resultats de l'extraction des temperatures
           </h2>
           {result && (
             <span className="text-sm text-muted">
               Fichier traite : <span className="font-semibold">{result.filename}</span>
             </span>
           )}
         </div>
         {renderTemperatures()}
       </div>
     </div>
   </Layout>
 );
}

