import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { StatCard, type StatCardProps } from "../components/StatCard";
import { Layout } from "../components/Layout";
import { ErrorPanel, LoadingPanel } from "../components/StatusPanel";
import bgDashboard from "../assets/bg-dashboard3.png";

import {
 fetchBulletins,
 fetchMetricsByDate,
 fetchMetricsList,
 fetchQualitySummary,
 type BulletinSummary,
 type DataQualityResponse,
 type MetricsResponse,
} from "../services/api";

const initialStats: StatCardProps[] = [
 { icon: "device_thermostat", label: "Écart moyen (MAE) Tmax", value: "--", delta: "RMSE --", accent: "primary" },
 { icon: "model_training", label: "Écart moyen (MAE) Tmin", value: "--", delta: "RMSE --", accent: "accent" },
 { icon: "thermostat_auto", label: "Biais Tmax", value: "--", delta: "Biais Tmin --" },
 { icon: "verified", label: "Exactitude", value: "--", delta: "Précision --", accent: "secondary" },
 { icon: "task_alt", label: "Rappel / F1", value: "--", delta: "F1 --", accent: "gold" },
 { icon: "insights", label: "Qualité moyenne", value: "--", delta: "Stations --" },
];

const buildStats = (
 data: MetricsResponse | null,
 quality: DataQualityResponse | null,
): StatCardProps[] => {
 const metrics = data ?? ({} as MetricsResponse);
 const avgQuality = quality?.average_quality;
 const qualityValue =
 typeof avgQuality === "number" ? `${(avgQuality * 100).toFixed(0)}%` : "--";
 const qualityDelta =
 typeof quality?.sample_size === "number" ? `Stations ${quality.sample_size}` : "Stations --";

 return [
 {
  icon: "device_thermostat",
  label: "Écart moyen Tmax",
  value: `${(metrics.mae_tmax ?? 0).toFixed(2)}C`,
  delta: `RMSE ${(metrics.rmse_tmax ?? 0).toFixed(2)}°C`,
  accent: "primary",
 },
 {
  icon: "model_training",
  label: "Écart moyen Tmin",
  value: `${(metrics.mae_tmin ?? 0).toFixed(2)}C`,
  delta: `RMSE ${(metrics.rmse_tmin ?? 0).toFixed(2)}°C`,
  accent: "accent",
 },
 {
  icon: "thermostat_auto",
  label: "Biais Tmax",
  value: `${(metrics.bias_tmax ?? 0).toFixed(2)}C`,
  delta: `Biais Tmin ${(metrics.bias_tmin ?? 0).toFixed(2)}C`,
 },
 {
  icon: "verified",
  label: "Exactitude",
  value: `${((metrics.accuracy_weather ?? 0) * 100).toFixed(1)}%`,
  delta: `Précision ${(metrics.precision_weather ?? 0).toFixed(2)}` ,
  accent: "secondary",
 },
 {
  icon: "task_alt",
  label: "Rappel / F1",
  value: `${((metrics.recall_weather ?? 0) * 100).toFixed(1)}%`,
  delta: `F1 ${(metrics.f1_score_weather ?? 0).toFixed(2)}` ,
  accent: "gold",
 },
 {
  icon: "insights",
  label: "Qualité moyenne",
  value: qualityValue,
  delta: qualityDelta,
 },
 ];
};

const buildCalendar = (monthValue: string) => {
 if (!monthValue || !/^\d{4}-\d{2}$/.test(monthValue)) {
 return [] as string[][];
 }
 const [yearStr, monthStr] = monthValue.split("-");
 const year = Number(yearStr);
 const monthIndex = Number(monthStr) - 1;
 if (Number.isNaN(year) || Number.isNaN(monthIndex)) {
 return [] as string[][];
 }
 const firstDay = new Date(year, monthIndex, 1);
 const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
 const startDay = firstDay.getDay();

 const weeks: string[][] = [];
 let currentWeek = Array(7).fill("");
 for (let i = 0; i < startDay; i += 1) {
 currentWeek[i] = "";
 }
 for (let day = 1; day <= daysInMonth; day += 1) {
 const index = (startDay + day - 1) % 7;
 currentWeek[index] = String(day);
 if (index === 6 || day === daysInMonth) {
  weeks.push(currentWeek);
  currentWeek = Array(7).fill("");
 }
 }
 return weeks;
};

export function DashboardPage() {
 const navigate = useNavigate();
 const [metrics, setMetrics] = useState<MetricsResponse | null>(null);
 const [quality, setQuality] = useState<DataQualityResponse | null>(null);
 const [metricsHistory, setMetricsHistory] = useState<MetricsResponse[]>([]);
 const [loading, setLoading] = useState<boolean>(false);
 const [datesError, setDatesError] = useState<string | null>(null);
 const [metricsError, setMetricsError] = useState<string | null>(null);
 const [trendError, setTrendError] = useState<string | null>(null);
 const [availableDates, setAvailableDates] = useState<string[]>([]);
 const [bulletins, setBulletins] = useState<BulletinSummary[]>([]);
 const [selectedDate, setSelectedDate] = useState<string>("");
 const [selectedMonth, setSelectedMonth] = useState<string>("");

 useEffect(() => {
 const loadDates = async () => {
  try {
  const payload = await fetchBulletins();
  const items = Array.isArray(payload.bulletins) ? payload.bulletins : [];
  const dates = Array.from(
   new Set(items.map((item) => item.date).filter((date): date is string => Boolean(date))),
  );
  dates.sort((a, b) => (a > b ? -1 : 1));
  setAvailableDates(dates);
  setBulletins(items);
  if (dates.length > 0) {
   setSelectedDate(dates[0]);
   setSelectedMonth(dates[0].slice(0, 7));
  }
  setDatesError(null);
  } catch (err) {
  console.error("Échec du chargement des dates:", err);
  setDatesError("Échec du chargement des dates.");
  }
 };
 loadDates();
 }, []);

 useEffect(() => {
 const loadMetrics = async () => {
  if (!selectedDate) return;
  try {
  setLoading(true);
  const data = await fetchMetricsByDate(selectedDate);
  if (!data) {
   throw new Error("Données de métriques vides.");
  }
  setMetrics(data);
  setMetricsError(null);
  } catch (err) {
  const status = (err as { status?: number })?.status;
  if (status === 404) {
   setMetricsError("Aucune métrique disponible pour cette date.");
  } else {
   console.error("Échec du chargement des métriques:", err);
   setMetricsError("Échec du chargement des métriques du tableau de bord.");
  }
  setMetrics((prev) => (prev ? null : prev));
  setMetrics(null);
  } finally {
  setLoading(false);
  }
 };
 loadMetrics();
 }, [selectedDate]);

 useEffect(() => {
 const loadMetricsHistory = async () => {
  if (!selectedDate) return;
  try {
  const list = await fetchMetricsList(60);
  setMetricsHistory(Array.isArray(list.items) ? list.items : []);
  setTrendError(null);
  } catch (err) {
  console.error("Echec du chargement de l'historique:", err);
  setTrendError("Echec du chargement de l'historique des tendances.");
  setMetricsHistory([]);
  }
 };
 loadMetricsHistory();
 }, [selectedDate]);

 useEffect(() => {
 const loadQuality = async () => {
  if (!selectedDate) return;
  try {
  const summary = await fetchQualitySummary(selectedDate);
  setQuality(summary);
  } catch (err) {
  console.error("Erreur chargement qualité:", err);
  setQuality(null);
  }
 };
 loadQuality();
 }, [selectedDate]);

 const availableDaysByMonth = useMemo(() => {
 const map: Record<string, string[]> = {};
 availableDates.forEach((date) => {
  const month = date.slice(0, 7);
  const day = date.slice(8, 10);
  map[month] = map[month] ? [...map[month], day] : [day];
 });
 return map;
 }, [availableDates]);

 const calendarDays = useMemo(() => buildCalendar(selectedMonth), [selectedMonth]);
 const availableDaysForMonth = availableDaysByMonth[selectedMonth] || [];

 useEffect(() => {
  if (!selectedMonth || !availableDaysByMonth[selectedMonth]) return;

  const days = availableDaysByMonth[selectedMonth];
  if (days.length > 0) {
   const sortedDays = [...days].sort((a, b) => b.localeCompare(a));
   const lastDay = sortedDays[0];
   const newDate = `${selectedMonth}-${lastDay}`;

   if (selectedDate !== newDate) {
    setSelectedDate(newDate);
    setMetricsError(null);
   }
  }
 }, [selectedMonth, availableDaysByMonth, selectedDate]);

 const stats = useMemo(() => {
  if (!metrics && !quality) return initialStats;
  return buildStats(metrics, quality);
 }, [metrics, quality]);

 const bulletinCount = bulletins.length;
 const observationCount = bulletins.filter((item) => item.type === "observation").length;
 const forecastCount = bulletins.filter((item) => item.type === "forecast").length;
 const pagesCount = bulletins.reduce((sum, item) => sum + (item.pages ?? 0), 0);
 const confusion = metrics?.confusion_matrix ?? null;
 const trendData = useMemo(() => {
 const sorted = [...metricsHistory]
  .filter((item) => Boolean(item?.date))
  .sort((a, b) => (a.date > b.date ? 1 : -1));
 return sorted.map((item) => ({
  date: item.date,
  maeTmin: typeof item.mae_tmin === "number" ? item.mae_tmin : null,
  maeTmax: typeof item.mae_tmax === "number" ? item.mae_tmax : null,
 }));
 }, [metricsHistory]);

 const maxConfusionValue = useMemo(() => {
  const flat = confusion?.matrix?.flat() ?? [];
  return flat.length > 0 ? Math.max(...flat) : 0;
 }, [confusion]);

 const chartWidth = 640;
 const chartHeight = 220;
 const chartPadding = 28;
 const chartInnerWidth = chartWidth - chartPadding * 2;
 const chartInnerHeight = chartHeight - chartPadding * 2;
 const trendValues = trendData.flatMap((item) =>
  [item.maeTmin, item.maeTmax].filter((value): value is number => typeof value === "number"),
 );
 const trendMin = trendValues.length > 0 ? Math.min(...trendValues) : 0;
 const trendMax = trendValues.length > 0 ? Math.max(...trendValues) : 1;
 const trendRange = trendMax === trendMin ? 1 : trendMax - trendMin;

 const buildLinePath = (values: Array<number | null>) => {
  const points = values
  .map((value, index) => {
   if (value === null || trendData.length < 2) return null;
   const x = chartPadding + (index / (trendData.length - 1)) * chartInnerWidth;
   const y =
   chartPadding + (1 - (value - trendMin) / trendRange) * chartInnerHeight;
   return { x, y };
  })
  .filter((point): point is { x: number; y: number } => Boolean(point));

  if (points.length === 0) return "";
  return points.reduce(
  (path, point, index) =>
   `${path}${index === 0 ? "M" : " L"}${point.x},${point.y}`,
  "",
  );
 };

 const tminPath = useMemo(
  () => buildLinePath(trendData.map((item) => item.maeTmin)),
  [trendData, trendMin, trendMax],
 );
 const tmaxPath = useMemo(
  () => buildLinePath(trendData.map((item) => item.maeTmax)),
  [trendData, trendMin, trendMax],
 );

 const handleDayClick = (day: string) => {
 if (!day) return;
 const normalized = day.padStart(2, "0");
 if (!availableDaysForMonth.includes(normalized)) {
  setMetricsError("Aucune métrique pour cette date.");
  return;
 }
 const newDate = `${selectedMonth}-${normalized}`;
 setSelectedDate(newDate);
 setMetricsError(null);
 };

 if (loading) {
 return (
  <Layout title="Tableau de bord">
  <div className="space-y-6">
   <div className="surface-panel soft p-6">
   <h1 className="text-3xl font-semibold text-ink font-display">Tableau de bord technique</h1>
   <p className="text-sm text-muted">Chargement des données...</p>
   </div>
   <LoadingPanel message="Chargement des métriques du tableau de bord..." />
  </div>
  </Layout>
 );
 }

 return (
   <Layout title="Dashboard">
     <div className="space-y-6">
       {datesError && <ErrorPanel message={datesError} />}
       {metricsError && <ErrorPanel message={metricsError} />}
       <section className="grid gap-6 lg:grid-cols-[2.1fr,1fr]">
         <div
           className="relative overflow-hidden rounded-[1.25rem] p-6 bg-cover bg-center bg-no-repeat shadow-xl"
           style={{
             backgroundImage: `url(${bgDashboard})`,
           }}
         >
           {/* Dark overlay for text readability */}
           <div className="absolute inset-0 bg-gradient-to-br from-primary-900/85 via-primary-900/75 to-primary-800/80" />
           <div className="absolute inset-0 bg-secondary/30" />
           <div className="absolute -top-24 right-0 h-48 w-48 rounded-full bg-primary-400/20 blur-3xl" />
           <div className="absolute -bottom-20 left-0 h-40 w-40 rounded-full bg-sky-400/15 blur-3xl" />
           <div className="relative z-10 space-y-4">
             <div className="flex items-center gap-3 text-xs uppercase tracking-[0.4em] text-blue-200/70">
               <span className="inline-flex items-center gap-2 rounded-full bg-white/10 backdrop-blur-sm border border-white/10 px-3 py-1">
                 <span className="h-2 w-2 rounded-full bg-sky-400 pulse-soft" />
                 <span className="text-white/90">Temps réel</span>
               </span>
               <span className="text-blue-200/70">Contrôle qualité</span>
             </div>
             <div>
               <h1 className="text-3xl font-semibold text-white font-display drop-shadow-md">
                 Tableau de bord qualité prévision
               </h1>
               <p className="text-sm text-blue-100/80">
                 Synthèse des performances météo pour la date {selectedDate || "--"}.
               </p>
             </div>
             <div className="flex flex-wrap items-center gap-3">
               <button
                 onClick={() => navigate("/")}
                 className="inline-flex items-center gap-2 rounded-full bg-white px-5 py-2 text-sm font-semibold text-primary-900 shadow-lg hover:bg-blue-50 transition-colors"
               >
                 <span className="material-symbols-outlined text-base">home</span>
                 Accueil
               </button>
               <button className="rounded-full border border-white/25 bg-white/10 backdrop-blur-sm px-5 py-2 text-sm font-semibold text-white hover:bg-white/20 transition-colors">
                 Exporter le résumé
               </button>
               <button className="rounded-full border border-white/25 bg-white/10 backdrop-blur-sm px-5 py-2 text-sm font-semibold text-white hover:bg-white/20 transition-colors">
                 Voir tendances
               </button>
             </div>
             <div className="grid gap-3 sm:grid-cols-4">
               <div className="rounded-2xl border border-white/15 bg-white/10 backdrop-blur-sm p-4">
                 <p className="text-sm text-blue-100/80 font-medium">Bulletins</p>
                 <p className="text-lg font-semibold font-mono text-white">{bulletinCount}</p>
                 <p className="text-sm text-sky-300">
                   Obs {observationCount} / Prev {forecastCount}
                 </p>
               </div>
               <div className="rounded-2xl border border-white/15 bg-white/10 backdrop-blur-sm p-4">
                 <p className="text-sm text-blue-100/80 font-medium">Pages traitées</p>
                 <p className="text-lg font-semibold font-mono text-white">{pagesCount}</p>
                 <p className="text-sm text-sky-300">PDF découpés</p>
               </div>
               <div className="rounded-2xl border border-white/15 bg-white/10 backdrop-blur-sm p-4">
                 <p className="text-sm text-blue-100/80 font-medium">Dates chargées</p>
                 <p className="text-lg font-semibold font-mono text-white">{availableDates.length}</p>
                 <p className="text-sm text-sky-300">Dernière: {availableDates[0] ?? "--"}</p>
               </div>
               <div className="rounded-2xl border border-white/15 bg-white/10 backdrop-blur-sm p-4">
                 <p className="text-sm text-blue-100/80 font-medium">Échantillon</p>
                 <p className="text-lg font-semibold font-mono text-white">
                   {metrics?.sample_size ?? "--"}
                 </p>
                 <p className="text-sm text-sky-300">Stations évaluées</p>
               </div>
             </div>
           </div>
         </div>

         <div className="surface-panel p-6">
           <div className="flex items-center justify-between mb-4">
             <h3 className="text-sm uppercase tracking-[0.3em] text-ink font-semibold">Sélection</h3>
             <span className="text-xs font-mono text-primary-500">{selectedDate || "--"}</span>
           </div>
           <div className="space-y-4">
             <select
               className="w-full rounded-xl border border-[var(--border)] bg-[var(--canvas-strong)] px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/30"
               value={selectedMonth}
               onChange={(e) => setSelectedMonth(e.target.value)}
               disabled={Object.keys(availableDaysByMonth).length === 0}
             >
               {Object.keys(availableDaysByMonth).length === 0 && (
                 <option value="">Aucune donnée</option>
               )}
               {Object.keys(availableDaysByMonth).map((month) => (
                 <option key={month} value={month}>
                   {month}
                 </option>
               ))}
             </select>
             <div className="grid grid-cols-7 gap-1">
               {["D", "L", "M", "M", "J", "V", "S"].map((d, idx) => (
                 <div
                   key={`${d}-${idx}`}
                   className="text-center text-[11px] font-semibold text-muted py-1"
                 >
                   {d}
                 </div>
               ))}
             </div>
             <div className="grid grid-cols-7 gap-1">
               {calendarDays.flat().map((day, idx) =>
                 day ? (
                   <button
                     key={`${day}-${idx}`}
                     className={`h-9 rounded-lg text-sm font-medium transition-all ${
                       selectedDate.endsWith(day.padStart(2, "0"))
                         ? "bg-gradient-to-br from-primary-500 to-primary-600 text-white shadow-md shadow-primary-500/25"
                         : availableDaysForMonth.includes(day.padStart(2, "0"))
                           ? "text-ink hover:bg-primary-50 dark:hover:bg-primary-900/20"
                           : "text-muted/40 cursor-not-allowed"
                     }`}
                     onClick={() => handleDayClick(day)}
                     disabled={!availableDaysForMonth.includes(day.padStart(2, "0"))}
                   >
                     {day}
                   </button>
                 ) : (
                   <div key={`empty-${idx}`} />
                 ),
               )}
             </div>
           </div>
         </div>
       </section>

       <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
         {stats.map((stat, index) => (
           <div
             key={stat.label}
             className="animate-rise"
             style={{ animationDelay: `${index * 80}ms` }}
           >
             <StatCard {...stat} />
           </div>
         ))}
       </section>

       <section className="grid gap-6 lg:grid-cols-[1.3fr,1fr]">
         <div className="surface-panel p-6">
           <div className="flex items-center justify-between">
             <h3 className="text-lg font-semibold text-ink font-display">Tendances température</h3>
             <span className="rounded-full bg-primary-50 dark:bg-primary-900/20 px-3 py-1 text-xs font-medium text-primary-600 dark:text-primary-400">
               {trendData.length} pts
             </span>
           </div>
           <div className="mt-4 rounded-2xl border border-[var(--border)] bg-[var(--canvas-strong)] p-4">
             {trendError ? (
               <p className="text-sm text-muted">{trendError}</p>
             ) : trendData.length < 2 ? (
               <div className="flex items-center justify-center py-10 text-center text-muted">
                 <div>
                   <span className="material-symbols-outlined text-4xl mb-2 text-primary-300">show_chart</span>
                   <p className="text-sm">Pas assez de points pour tracer la tendance.</p>
                 </div>
               </div>
             ) : (
               <div>
                 <div className="flex flex-wrap items-center gap-4 text-xs text-muted">
                   <span className="inline-flex items-center gap-2">
                     <span className="h-2.5 w-2.5 rounded-full bg-primary-500" />
                     Écart moyen Tmin
                   </span>
                   <span className="inline-flex items-center gap-2">
                     <span className="h-2.5 w-2.5 rounded-full bg-sky-400" />
                     Écart moyen Tmax
                   </span>
                   <span className="ml-auto font-mono text-[11px]">
                     {trendMin.toFixed(2)}C - {trendMax.toFixed(2)}C
                   </span>
                 </div>
                 <svg
                   className="mt-4 h-56 w-full"
                   viewBox={`0 0 ${chartWidth} ${chartHeight}`}
                   role="img"
                   aria-label="Tendances Écart moyen Tmin et Tmax"
                 >
                   <defs>
                     <linearGradient id="tminGrad" x1="0" y1="0" x2="1" y2="0">
                       <stop offset="0%" stopColor="#0A9AFF" />
                       <stop offset="100%" stopColor="#3B82F6" />
                     </linearGradient>
                     <linearGradient id="tmaxGrad" x1="0" y1="0" x2="1" y2="0">
                       <stop offset="0%" stopColor="#38BDF8" />
                       <stop offset="100%" stopColor="#60A5FA" />
                     </linearGradient>
                   </defs>
                   <rect
                     x={chartPadding}
                     y={chartPadding}
                     width={chartInnerWidth}
                     height={chartInnerHeight}
                     rx={18}
                     fill="var(--surface)"
                     opacity="0.7"
                   />
                   <path
                     d={tminPath}
                     fill="none"
                     stroke="url(#tminGrad)"
                     strokeWidth={2.5}
                     strokeLinecap="round"
                   />
                   <path
                     d={tmaxPath}
                     fill="none"
                     stroke="url(#tmaxGrad)"
                     strokeWidth={2.5}
                     strokeLinecap="round"
                   />
                   {trendData.map((item, index) => {
                     const x = chartPadding + (index / (trendData.length - 1)) * chartInnerWidth;
                     const yMin =
                       item.maeTmin === null
                         ? null
                         : chartPadding +
                           (1 - (item.maeTmin - trendMin) / trendRange) * chartInnerHeight;
                     const yMax =
                       item.maeTmax === null
                         ? null
                         : chartPadding +
                           (1 - (item.maeTmax - trendMin) / trendRange) * chartInnerHeight;
                     return (
                       <g key={`point-${item.date}-${index}`}>
                         {yMin !== null && <circle cx={x} cy={yMin} r={3.5} fill="#0A9AFF" />}
                         {yMax !== null && <circle cx={x} cy={yMax} r={3.5} fill="#38BDF8" />}
                       </g>
                     );
                   })}
                 </svg>
                 <div className="mt-2 flex justify-between text-[11px] text-muted font-mono">
                   <span>{trendData[0]?.date ?? ""}</span>
                   <span>{trendData[trendData.length - 1]?.date ?? ""}</span>
                 </div>
               </div>
             )}
           </div>
         </div>

         <div className="surface-panel p-6">
           <div className="flex items-center justify-between">
             <h3 className="text-lg font-semibold text-ink font-display">
               Matrice de classification
             </h3>
             <span className="rounded-full bg-secondary-50 dark:bg-secondary-700/15 px-3 py-1 text-xs font-medium text-secondary-600 dark:text-secondary-400">
               Étiquettes
             </span>
           </div>
           <div className="mt-4 overflow-x-auto">
             {confusion?.labels && confusion.matrix ? (
               <table className="min-w-full text-xs">
                 <thead>
                   <tr className="text-left text-muted">
                     <th className="py-2 pr-2"></th>
                     {confusion.labels.map((label) => (
                       <th key={label} className="py-2 px-2 text-center font-semibold">
                         Pred: {label}
                       </th>
                     ))}
                   </tr>
                 </thead>
                 <tbody>
                   {confusion.matrix.map((row, rowIndex) => (
                     <tr key={`row-${rowIndex}`} className="border-t border-[var(--border)]">
                       <td className="py-2 pr-2 font-semibold text-ink whitespace-nowrap">
                         Reel: {confusion.labels?.[rowIndex] ?? `L${rowIndex + 1}`}
                       </td>
                       {row.map((value, colIndex) => {
                         const intensity = maxConfusionValue ? value / maxConfusionValue : 0;
                         return (
                           <td
                             key={`cell-${rowIndex}-${colIndex}`}
                             className="py-2 px-2 text-center font-mono"
                             style={{
                               backgroundColor: `rgba(10, 154, 255, ${intensity * 0.3})`,
                               color: intensity > 0.55 ? "white" : "inherit",
                             }}
                           >
                             {value}
                           </td>
                         );
                       })}
                     </tr>
                   ))}
                 </tbody>
               </table>
             ) : (
               <div className="rounded-2xl border border-dashed border-[var(--border)] bg-[var(--canvas-strong)] p-6 text-center">
                 <span className="material-symbols-outlined text-3xl text-primary-300 mb-2">grid_view</span>
                 <p className="text-sm text-muted">
                   Aucune matrice de confusion disponible pour cette date.
                 </p>
               </div>
             )}
           </div>
         </div>
       </section>
     </div>
   </Layout>
 );
}
