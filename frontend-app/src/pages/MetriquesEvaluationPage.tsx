import { useEffect, useState } from "react";
import { Layout } from "../components/Layout";
import { ErrorPanel, LoadingPanel } from "../components/StatusPanel";
import { formatFrenchMonth } from "../services/api";
import {
  fetchMonthlyMetricsList,
  recalculateMetrics,
  type MonthlyMetricsResponse,
} from "../services/api";
export function MetriquesEvaluationPage() {
 const [monthlyMetrics, setMonthlyMetrics] = useState<MonthlyMetricsResponse[]>([]);
 const [selectedMetric, setSelectedMetric] = useState<MonthlyMetricsResponse | null>(null);
 const [loading, setLoading] = useState<boolean>(false);
 const [error, setError] = useState<string | null>(null);
 const [recalcLoading, setRecalcLoading] = useState<boolean>(false);
 const [recalcMessage, setRecalcMessage] = useState<string | null>(null);

 const loadMonthlyMetrics = async () => {
  try {
   setLoading(true);
   const payload = await fetchMonthlyMetricsList(24);
   const items = payload.items ?? [];
   setMonthlyMetrics(items);
   if (items.length > 0 && !selectedMetric) {
    setSelectedMetric(items[0]);
   }
   setError(null);
  } catch (err) {
   console.error("Échec du chargement des métriques mensuelles:", err);
   setError("Échec du chargement des métriques mensuelles.");
   setMonthlyMetrics([]);
  } finally {
   setLoading(false);
  }
 };

 useEffect(() => {
  loadMonthlyMetrics();
 }, []);

 const handleRecalculate = async () => {
  try {
   setRecalcLoading(true);
   setRecalcMessage(null);
   const result = await recalculateMetrics(true);
   if (result.status === "no_data") {
    setRecalcMessage(result.message ?? "Aucune donnée pour recalculer.");
   } else {
    const monthsAgg = result.result?.monthly?.months_aggregated ?? 0;
    setRecalcMessage(`Recalcul terminé : ${monthsAgg} mois agrégés.`);
    await loadMonthlyMetrics();
   }
  } catch (err) {
   console.error("Échec du recalcul:", err);
   setRecalcMessage("Échec du recalcul des métriques.");
  } finally {
   setRecalcLoading(false);
  }
 };

 const getMetricColor = (value: number, type: "mae" | "rmse" | "bias" | "accuracy") => {
  if (type === "accuracy") {
   if (value >= 0.9) return "text-green-600 dark:text-green-400";
   if (value >= 0.7) return "text-yellow-600 dark:text-yellow-400";
   return "text-red-600 dark:text-red-400";
  }
  if (type === "bias") {
   if (Math.abs(value) <= 0.5) return "text-green-600 dark:text-green-400";
   if (Math.abs(value) <= 1.0) return "text-yellow-600 dark:text-yellow-400";
   return "text-red-600 dark:text-red-400";
  }
  if (value <= 1.0) return "text-green-600 dark:text-green-400";
  if (value <= 2.0) return "text-yellow-600 dark:text-yellow-400";
  return "text-red-600 dark:text-red-400";
 };

 const formatMonth = (year: number, month: number) => {
  return formatFrenchMonth(year, month);
 };

 return (
   <Layout title="Métriques d'Évaluation (Mensuelles)">
     <div className="space-y-6">
       <div className="bg-[var(--surface)] rounded-2xl border border-[var(--border)] p-6 shadow-lg">
         <div className="flex flex-wrap items-center justify-between gap-4">
           <div className="flex items-center gap-3">
             <div className="size-10 rounded-xl bg-gradient-to-br from-primary-500 to-secondary-600 flex items-center justify-center">
               <span className="material-symbols-outlined text-white">calendar_today</span>
             </div>
             <div>
               <label className="block text-sm font-medium text-ink">Mois sélectionné</label>
               <select
                 value={
                   selectedMetric ? formatMonth(selectedMetric.year, selectedMetric.month) : ""
                 }
                 onChange={(e) => {
                   const selected = monthlyMetrics.find(
                     (m) => formatMonth(m.year, m.month) === e.target.value,
                   );
                   setSelectedMetric(selected ?? null);
                 }}
                 className="mt-1 rounded-xl border border-[var(--border)] bg-[var(--surface-strong)] px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
               >
                 {monthlyMetrics.length === 0 && <option value="">Aucun mois</option>}
                 {monthlyMetrics.map((metric) => (
                   <option
                     key={formatMonth(metric.year, metric.month)}
                     value={`${metric.year}-${metric.month.toString().padStart(2, "0")}`}
                   >
                     {formatMonth(metric.year, metric.month)}
                   </option>
                 ))}
               </select>
             </div>
           </div>
           <div className="flex gap-6">
             <div className="text-sm">
               <p className="text-muted">Jours évalués</p>
               <p className="font-semibold text-ink">{selectedMetric?.days_evaluated ?? "N/A"}</p>
             </div>
             <div className="text-sm">
               <p className="text-muted">Taille échantillon</p>
               <p className="font-semibold text-ink">{selectedMetric?.sample_size ?? "N/A"}</p>
             </div>
             <div className="text-sm">
               <p className="text-muted">Recalcul global</p>
               <button
                 type="button"
                 onClick={handleRecalculate}
                 disabled={recalcLoading}
                 className="mt-1 inline-flex items-center gap-2 rounded-xl border border-blue-200 bg-blue-50 px-3 py-2 text-sm font-semibold text-blue-700 transition hover:bg-blue-100 disabled:opacity-50"
               >
                 <span className="material-symbols-outlined text-base">refresh</span>
                 {recalcLoading ? "En cours..." : "Recalculer"}
               </button>
             </div>
           </div>
         </div>
         {recalcMessage && (
           <p className="mt-4 text-sm font-medium text-blue-600 dark:text-blue-400">
             {recalcMessage}
           </p>
         )}
       </div>

       {loading && <LoadingPanel message="Chargement des métriques..." />}

       {error && <ErrorPanel message={error} />}

       {!loading && selectedMetric && (
         <>
           <div className="bg-[var(--surface)] rounded-2xl border border-[var(--border)] shadow-lg">
             <div className="px-6 py-4 border-b border-[var(--border)] bg-gradient-to-r from-blue-50 to-green-50 dark:from-[var(--surface-strong)] dark:to-[var(--canvas-strong)]">
               <div className="flex items-center gap-3">
                 <div className="size-10 rounded-xl bg-gradient-to-br from-blue-500 to-green-500 flex items-center justify-center">
                   <span className="material-symbols-outlined text-white">thermometer</span>
                 </div>
                 <h3 className="text-lg font-bold text-ink">Température (Moyenne mensuelle)</h3>
               </div>
             </div>
             <div className="p-6">
               <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                 <div className="bg-gradient-to-br from-blue-50 to-blue-100 dark:from-blue-900/20 dark:to-blue-800/20 rounded-xl p-5 border border-blue-200 dark:border-blue-800">
                   <div className="flex items-center gap-2 mb-4">
                     <span className="material-symbols-outlined text-blue-500">show_chart</span>
                     <h4 className="text-sm font-semibold text-ink">MAE</h4>
                   </div>
                   <div className="space-y-3">
                     <div className="flex justify-between items-center bg-[var(--surface)] rounded-2xl p-3">
                       <span className="text-sm text-muted">Tmin:</span>
                       <span
                         className={`text-lg font-bold ${getMetricColor(selectedMetric.mae_tmin ?? 0, "mae")}`}
                       >
                         {(selectedMetric.mae_tmin ?? 0).toFixed(2)}°C
                       </span>
                     </div>
                     <div className="flex justify-between items-center bg-[var(--surface)] rounded-2xl p-3">
                       <span className="text-sm text-muted">Tmax:</span>
                       <span
                         className={`text-lg font-bold ${getMetricColor(selectedMetric.mae_tmax ?? 0, "mae")}`}
                       >
                         {(selectedMetric.mae_tmax ?? 0).toFixed(2)}°C
                       </span>
                     </div>
                   </div>
                 </div>

                 <div className="space-y-2">
                   <h4 className="text-sm font-semibold text-ink">RMSE</h4>
                   <div className="space-y-1">
                     <div className="flex justify-between">
                       <span className="text-sm text-muted">Tmin:</span>
                       <span
                         className={`text-base font-bold ${getMetricColor(selectedMetric.rmse_tmin ?? 0, "rmse")}`}
                       >
                         {(selectedMetric.rmse_tmin ?? 0).toFixed(2)}°C
                       </span>
                     </div>
                     <div className="flex justify-between">
                       <span className="text-sm text-muted">Tmax:</span>
                       <span
                         className={`text-base font-bold ${getMetricColor(selectedMetric.rmse_tmax ?? 0, "rmse")}`}
                       >
                         {(selectedMetric.rmse_tmax ?? 0).toFixed(2)}°C
                       </span>
                     </div>
                   </div>
                 </div>

                 <div className="space-y-2">
                   <h4 className="text-sm font-semibold text-ink">Bias</h4>
                   <div className="space-y-1">
                     <div className="flex justify-between">
                       <span className="text-sm text-muted">Tmin:</span>
                       <span
                         className={`text-base font-bold ${getMetricColor(selectedMetric.bias_tmin ?? 0, "bias")}`}
                       >
                         {(selectedMetric.bias_tmin ?? 0) > 0 ? "+" : ""}
                         {(selectedMetric.bias_tmin ?? 0).toFixed(2)}°C
                       </span>
                     </div>
                     <div className="flex justify-between">
                       <span className="text-sm text-muted">Tmax:</span>
                       <span
                         className={`text-base font-bold ${getMetricColor(selectedMetric.bias_tmax ?? 0, "bias")}`}
                       >
                         {(selectedMetric.bias_tmax ?? 0) > 0 ? "+" : ""}
                         {(selectedMetric.bias_tmax ?? 0).toFixed(2)}°C
                       </span>
                     </div>
                   </div>
                 </div>
               </div>
             </div>
           </div>

           <div className="bg-[var(--surface)] rounded-2xl border border-[var(--border)] shadow-lg">
             <div className="px-4 py-3 border-b border-[var(--border)] bg-[var(--surface-strong)]">
               <h3 className="text-lg font-bold text-ink">Classification météo</h3>
             </div>
             <div className="p-4">
               <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                 <div className="space-y-2">
                   <h4 className="text-sm font-semibold text-ink">Accuracy</h4>
                   <p
                     className={`text-3xl font-bold ${getMetricColor(selectedMetric.accuracy_weather ?? 0, "accuracy")}`}
                   >
                     {((selectedMetric.accuracy_weather ?? 0) * 100).toFixed(1)}%
                   </p>
                 </div>
                 <div className="space-y-2">
                   <h4 className="text-sm font-semibold text-ink">Precision</h4>
                   <p
                     className={`text-3xl font-bold ${getMetricColor(selectedMetric.precision_weather ?? 0, "accuracy")}`}
                   >
                     {((selectedMetric.precision_weather ?? 0) * 100).toFixed(1)}%
                   </p>
                 </div>
                 <div className="space-y-2">
                   <h4 className="text-sm font-semibold text-ink">Recall</h4>
                   <p
                     className={`text-3xl font-bold ${getMetricColor(selectedMetric.recall_weather ?? 0, "accuracy")}`}
                   >
                     {((selectedMetric.recall_weather ?? 0) * 100).toFixed(1)}%
                   </p>
                 </div>
                 <div className="space-y-2">
                   <h4 className="text-sm font-semibold text-ink">F1 Score</h4>
                   <p
                     className={`text-3xl font-bold ${getMetricColor(selectedMetric.f1_score_weather ?? 0, "accuracy")}`}
                   >
                     {((selectedMetric.f1_score_weather ?? 0) * 100).toFixed(1)}%
                   </p>
                 </div>
               </div>
             </div>
           </div>

           <div className="bg-[var(--surface)] rounded-2xl border border-[var(--border)] shadow-lg">
             <div className="px-4 py-3 border-b border-[var(--border)] bg-[var(--surface-strong)]">
               <h3 className="text-lg font-bold text-ink">Historique des métriques mensuelles</h3>
             </div>
             <div className="p-4 overflow-x-auto">
               {monthlyMetrics.length === 0 ? (
                 <p className="text-sm text-muted">Aucune métrique disponible.</p>
               ) : (
                 <table className="min-w-full text-sm">
                   <thead>
                     <tr className="text-left text-muted">
                       <th className="px-3 py-2">Mois</th>
                       <th className="px-3 py-2">Jours</th>
                       <th className="px-3 py-2">MAE Tmin</th>
                       <th className="px-3 py-2">MAE Tmax</th>
                       <th className="px-3 py-2">RMSE Tmin</th>
                       <th className="px-3 py-2">RMSE Tmax</th>
                       <th className="px-3 py-2">Accuracy</th>
                       <th className="px-3 py-2">Échantillon</th>
                     </tr>
                   </thead>
                   <tbody>
                     {monthlyMetrics.map((metric, idx) => (
                       <tr
                         key={`${metric.year}-${metric.month}-${idx}`}
                         onClick={() => setSelectedMetric(metric)}
                         className={`border-t border-[var(--border)] cursor-pointer hover:bg-[var(--surface-strong)] ${selectedMetric && selectedMetric.year === metric.year && selectedMetric.month === metric.month ? "bg-blue-50 dark:bg-blue-900/20" : ""}`}
                       >
                         <td className="px-3 py-2 font-medium text-ink">
                           {formatMonth(metric.year, metric.month)}
                         </td>
                         <td className="px-3 py-2 text-muted">{metric.days_evaluated ?? "N/A"}</td>
                         <td className="px-3 py-2 text-muted">
                           {(metric.mae_tmin ?? 0).toFixed(2)}
                         </td>
                         <td className="px-3 py-2 text-muted">
                           {(metric.mae_tmax ?? 0).toFixed(2)}
                         </td>
                         <td className="px-3 py-2 text-muted">
                           {(metric.rmse_tmin ?? 0).toFixed(2)}
                         </td>
                         <td className="px-3 py-2 text-muted">
                           {(metric.rmse_tmax ?? 0).toFixed(2)}
                         </td>
                         <td className="px-3 py-2 text-muted">
                           {((metric.accuracy_weather ?? 0) * 100).toFixed(1)}%
                         </td>
                         <td className="px-3 py-2 text-muted">{metric.sample_size ?? "N/A"}</td>
                       </tr>
                     ))}
                   </tbody>
                 </table>
               )}
             </div>
           </div>
         </>
       )}
     </div>
   </Layout>
 );
}
