import { useEffect, useMemo, useState } from "react";
import { Layout } from "../components/Layout";
import { ErrorPanel, LoadingPanel } from "../components/StatusPanel";
import {
 correctTemperature,
 fetchValidationIssues,
 ignoreValidationIssue,
 type DataIssue,
 type DataIssuesResponse,
} from "../services/api";

const SEVERITY_OPTIONS = ["all", "warning", "error", "info"];

export function ValidationIssuesPage() {
 const [issues, setIssues] = useState<DataIssue[]>([]);
 const [date, setDate] = useState("");
 const [station, setStation] = useState("");
 const [severity, setSeverity] = useState("all");
 const [loading, setLoading] = useState(false);
 const [actionLoading, setActionLoading] = useState<number | null>(null);
 const [error, setError] = useState<string | null>(null);
 const [editingIssueId, setEditingIssueId] = useState<number | null>(null);
 const [editTmin, setEditTmin] = useState("");
 const [editTmax, setEditTmax] = useState("");

 const loadIssues = async () => {
  try {
   setLoading(true);
   setError(null);
   const payload = await fetchValidationIssues({
    date: date || undefined,
    station: station || undefined,
    severity: severity === "all" ? undefined : severity,
    limit: 200,
    offset: 0,
   });
   setIssues(payload.items ?? []);
  } catch (err) {
   console.error("Échec du chargement des problèmes de validation:", err);
   setError("Échec du chargement des problèmes de validation.");
   setIssues([]);
  } finally {
   setLoading(false);
  }
 };

 useEffect(() => {
  loadIssues();
  // eslint-disable-next-line react-hooks/exhaustive-deps
 }, []);

 const filteredIssues = useMemo(() => {
  const stationQuery = station.trim().toLowerCase();
  return issues.filter((issue) => {
   if (date && issue.bulletin_date !== date) return false;
   if (severity !== "all" && issue.severity !== severity) return false;
   if (stationQuery && !(issue.station_name ?? "").toLowerCase().includes(stationQuery)) {
    return false;
   }
   return true;
  });
 }, [issues, date, severity, station]);

 const canCorrect = (issue: DataIssue) =>
  Boolean(issue.bulletin_date && issue.station_name && issue.map_type);

 const getIssueRowClass = (status?: string | null) => {
  const normalized = (status ?? "open").toLowerCase();
  if (normalized === "fixed") {
   return "bg-emerald-100/50";
  }
  return "bg-orange-100/70";
 };

 const handleIgnore = async (issue: DataIssue) => {
  if (!issue.id) return;
  try {
   setActionLoading(issue.id);
   await ignoreValidationIssue(issue.id);
   await loadIssues();
  } catch (err) {
   console.error("Échec de l'ignoration du problème:", err);
   setError("Échec de l'ignoration du problème.");
  } finally {
   setActionLoading(null);
  }
 };

 const handleStartEdit = (issue: DataIssue) => {
  setEditingIssueId(issue.id);
  setEditTmin("");
  setEditTmax("");
 };

 const handleApplyCorrection = async (issue: DataIssue) => {
  if (!issue.bulletin_date || !issue.station_name || !issue.map_type) return;
  const tmin = editTmin.trim() === "" ? null : Number(editTmin);
  const tmax = editTmax.trim() === "" ? null : Number(editTmax);
  if (Number.isNaN(tmin ?? 0) || Number.isNaN(tmax ?? 0)) {
   setError("Veuillez saisir des valeurs numériques valides.");
   return;
  }
  try {
   setActionLoading(issue.id);
   await correctTemperature({
    date: issue.bulletin_date,
    station_name: issue.station_name,
    map_type: issue.map_type as "observation" | "forecast",
    tmin,
    tmax,
    issue_id: issue.id,
   });
   setEditingIssueId(null);
   await loadIssues();
  } catch (err) {
   console.error("Échec de la correction des températures:", err);
   setError("Échec de l'application de la correction.");
  } finally {
   setActionLoading(null);
  }
 };

 return (
  <Layout title="Problèmes de validation">
   <div className="space-y-6">
    {error && <ErrorPanel message={error} />}
    <section className="surface-panel soft p-6">
     <div className="grid gap-4 sm:grid-cols-3">
      <div>
       <label className="block text-xs font-semibold uppercase tracking-[0.3em] text-muted mb-2">
        Date
       </label>
       <input
        type="date"
        value={date}
        onChange={(event) => setDate(event.target.value)}
        className="w-full rounded-2xl border border-[var(--border)] bg-[var(--surface)]/70 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
       />
      </div>
      <div>
       <label className="block text-xs font-semibold uppercase tracking-[0.3em] text-muted mb-2">
        Station
       </label>
       <input
        type="text"
        value={station}
        onChange={(event) => setStation(event.target.value)}
        placeholder="Ouagadougou..."
        className="w-full rounded-2xl border border-[var(--border)] bg-[var(--surface)]/70 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
       />
      </div>
      <div>
       <label className="block text-xs font-semibold uppercase tracking-[0.3em] text-muted mb-2">
        Gravité
       </label>
       <select
        value={severity}
        onChange={(event) => setSeverity(event.target.value)}
        className="w-full rounded-2xl border border-[var(--border)] bg-[var(--surface)]/70 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
       >
        {SEVERITY_OPTIONS.map((option) => (
         <option key={option} value={option}>
          {option === "all" ? "Tous" : option === "warning" ? "Avertissement" : option === "error" ? "Erreur" : "Info"}
         </option>
        ))}
       </select>
      </div>
     </div>
     <div className="mt-4 flex flex-wrap gap-3">
      <button
       type="button"
       onClick={loadIssues}
       className="rounded-full bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-700 transition-colors"
      >
       Actualiser
      </button>
      <button
       type="button"
       onClick={() => {
        setDate("");
        setStation("");
        setSeverity("all");
       }}
       className="rounded-full border border-[var(--border)] px-4 py-2 text-xs font-semibold text-ink hover:bg-[var(--canvas-strong)] transition-colors"
      >
       Réinitialiser
      </button>
     </div>
    </section>

    <section className="surface-panel overflow-hidden">
     <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border)] bg-[var(--canvas-strong)]">
      <div>
       <h3 className="text-lg font-semibold text-ink font-display">Problèmes</h3>
       <p className="text-xs text-muted">{filteredIssues.length} problème(s)</p>
      </div>
     </div>
     {loading && (
      <div className="p-6">
       <LoadingPanel message="Chargement des problèmes de validation..." />
      </div>
     )}
     {!loading && filteredIssues.length === 0 && (
      <div className="p-6 text-sm text-muted">Aucun problème de validation trouvé.</div>
     )}
     {!loading && filteredIssues.length > 0 && (
      <div className="overflow-x-auto">
       <table className="w-full text-left text-sm">
        <thead className="bg-[var(--surface)]/70 text-xs uppercase tracking-[0.2em] text-muted">
         <tr>
          <th className="px-6 py-3">Date</th>
          <th className="px-6 py-3">Station</th>
          <th className="px-6 py-3">Type</th>
          <th className="px-6 py-3">Code</th>
          <th className="px-6 py-3">Gravité</th>
          <th className="px-6 py-3">Statut</th>
          <th className="px-6 py-3">Message</th>
          <th className="px-6 py-3 text-right">Actions</th>
         </tr>
        </thead>
        <tbody className="divide-y divide-[var(--border)]">
         {filteredIssues.map((issue) => (
          <tr
           key={issue.id}
           className={`${getIssueRowClass(issue.status)} hover:bg-[var(--canvas-strong)]`}
          >
           <td className="px-6 py-4 font-mono">{issue.bulletin_date ?? "--"}</td>
           <td className="px-6 py-4">{issue.station_name ?? "--"}</td>
           <td className="px-6 py-4">{issue.map_type === "observation" ? "Observation" : issue.map_type === "forecast" ? "Prévision" : issue.map_type ?? "--"}</td>
           <td className="px-6 py-4">{issue.code ?? "--"}</td>
           <td className="px-6 py-4">{issue.severity ?? "--"}</td>
           <td className="px-6 py-4">{issue.status ?? "open"}</td>
           <td className="px-6 py-4 text-xs text-muted">{issue.message ?? "--"}</td>
           <td className="px-6 py-4 text-right">
            <div className="flex flex-wrap justify-end gap-2">
             <button
              type="button"
              onClick={() => handleIgnore(issue)}
              className="rounded-full border border-[var(--border)] px-3 py-1 text-xs font-semibold text-ink hover:bg-[var(--canvas-strong)] transition-colors"
              disabled={actionLoading === issue.id}
             >
              Ignorer
             </button>
             <button
              type="button"
              onClick={() => handleStartEdit(issue)}
              className="rounded-full bg-emerald-600 px-3 py-1 text-xs font-semibold text-white hover:bg-emerald-700 transition-colors"
              disabled={!canCorrect(issue) || actionLoading === issue.id}
             >
              Corriger
             </button>
            </div>
            {editingIssueId === issue.id && (
             <div className="mt-3 grid gap-2 sm:grid-cols-3">
              <input
               type="number"
               placeholder="Tmin"
               value={editTmin}
               onChange={(event) => setEditTmin(event.target.value)}
               className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface)]/70 px-3 py-1 text-xs"
              />
              <input
               type="number"
               placeholder="Tmax"
               value={editTmax}
               onChange={(event) => setEditTmax(event.target.value)}
               className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface)]/70 px-3 py-1 text-xs"
              />
              <div className="flex gap-2">
               <button
                type="button"
                onClick={() => handleApplyCorrection(issue)}
                className="rounded-full bg-emerald-600 px-3 py-1 text-xs font-semibold text-white hover:bg-emerald-700 transition-colors"
                disabled={actionLoading === issue.id}
               >
                Enregistrer
               </button>
               <button
                type="button"
                onClick={() => setEditingIssueId(null)}
                className="rounded-full border border-[var(--border)] px-3 py-1 text-xs font-semibold text-ink hover:bg-[var(--canvas-strong)] transition-colors"
               >
                Annuler
               </button>
              </div>
             </div>
            )}
           </td>
          </tr>
         ))}
        </tbody>
       </table>
      </div>
     )}
    </section>
   </div>
  </Layout>
 );
}
