import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { StatCard, type StatCardProps } from "../components/StatCard";
import { Layout } from "../components/Layout";
import { ErrorPanel, LoadingPanel } from "../components/StatusPanel";
import bgDashboard from "../assets/bg-dashboard3.png";

import {
 fetchAuthMe,
 fetchBulletins,
 fetchBulletinByDate,
 fetchMetricsByDate,
 fetchMetricsList,
 fetchQualitySummary,
 getAuthToken,
 setAuthToken,
 type BulletinDetail,
 type BulletinSummary,
 type DataQualityResponse,
 type MetricsResponse,
} from "../services/api";

const initialStats: StatCardProps[] = [
 { icon: "device_thermostat", label: "Performance Tmax", value: "Ecart moyen Tmax --", delta: "RMSE --", accent: "danger" },
 { icon: "model_training", label: "Performance Tmin", value: "Ecart moyen Tmin --", delta: "RMSE --", accent: "accent" },
 { icon: "thermostat_auto", label: "Biais", value: "Biais Tmax --", delta: "Biais Tmin --" },
//  { icon: "insights", label: "Qualite moyenne", value: "--", delta: "Stations --" },
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
 const sampleSize = typeof metrics.sample_size === "number" ? metrics.sample_size : 0;
 const formatValue = (value?: number | null, suffix = "") =>
  sampleSize < 2 ? "--" : typeof value === "number" ? `${value.toFixed(2)}${suffix}` : "--";
 const formatLine = (label: string, value?: number | null, suffix = "C") =>
  `${label} ${formatValue(value, suffix)}`;

 return [
 {
  icon: "device_thermostat",
  label: "Performance Tmax",
  value: formatLine("Ecart moyen Tmax", metrics.mae_tmax),
  delta: `RMSE ${formatValue(metrics.rmse_tmax, "C")}`,
  accent: "danger",
 },
 {
  icon: "model_training",
  label: "Performance Tmin",
  value: formatLine("Ecart moyen Tmin", metrics.mae_tmin),
  delta: `RMSE ${formatValue(metrics.rmse_tmin, "C")}`,
  accent: "primary",
 },
 {
  icon: "thermostat_auto",
  label: "Biais",
  value: formatLine("Biais Tmax", metrics.bias_tmax),
  delta: `Biais Tmin ${formatValue(metrics.bias_tmin, "C")}`,
 },
//  {
//   icon: "insights",
//   label: "Qualité moyenne",
//   value: qualityValue,
//   delta: qualityDelta,
//  },
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
 const [isOnline, setIsOnline] = useState(() =>
  typeof navigator !== "undefined" ? navigator.onLine : true,
 );
 const [authStatus, setAuthStatus] = useState<"checking" | "connected" | "disconnected">(
  "checking",
 );
 const [authUser, setAuthUser] = useState<string | null>(null);
 const [datesError, setDatesError] = useState<string | null>(null);
 const [metricsError, setMetricsError] = useState<string | null>(null);
 const [trendError, setTrendError] = useState<string | null>(null);
 const [monthBulletins, setMonthBulletins] = useState<
  Array<{
   date: string;
   data: BulletinDetail;
  }>
 >([]);
 const [availableStations, setAvailableStations] = useState<string[]>([]);
 const [selectedStation, setSelectedStation] = useState<string>("");
 const [stationTrend, setStationTrend] = useState<
  Array<{
   date: string;
   tminObs: number | null;
   tminPrev: number | null;
   tmaxObs: number | null;
   tmaxPrev: number | null;
  }>
 >([]);
 const [tempTrendError, setTempTrendError] = useState<string | null>(null);
 const [availableDates, setAvailableDates] = useState<string[]>([]);
 const [bulletins, setBulletins] = useState<BulletinSummary[]>([]);
 const [selectedDate, setSelectedDate] = useState<string>("");
 const [selectedMonth, setSelectedMonth] = useState<string>("");

 useEffect(() => {
  const handleOnline = () => setIsOnline(true);
  const handleOffline = () => setIsOnline(false);
  window.addEventListener("online", handleOnline);
  window.addEventListener("offline", handleOffline);
  return () => {
   window.removeEventListener("online", handleOnline);
   window.removeEventListener("offline", handleOffline);
  };
 }, []);

 useEffect(() => {
  let cancelled = false;
  const checkAuth = async () => {
   if (!isOnline) {
    setAuthStatus("disconnected");
    setAuthUser(null);
    return;
   }
   const token = getAuthToken();
   if (!token) {
    setAuthStatus("disconnected");
    setAuthUser(null);
    return;
   }
   setAuthStatus("checking");
   try {
    const payload = await fetchAuthMe();
    if (cancelled) return;
    setAuthStatus("connected");
    setAuthUser(payload.username);
   } catch (err) {
    if (cancelled) return;
    const status = (err as { status?: number })?.status;
    if (status === 401 || status === 403) {
     setAuthToken(null);
    }
    setAuthStatus("disconnected");
    setAuthUser(null);
   }
  };
  checkAuth();
  return () => {
   cancelled = true;
  };
 }, [isOnline]);

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

 const normalizeStationName = (name?: string | null) => (name ?? "").trim().toUpperCase();

 useEffect(() => {
  if (!selectedMonth) return;
  const dates = availableDates
   .filter((date) => date.startsWith(selectedMonth))
   .sort((a, b) => (a > b ? 1 : -1));
  if (dates.length === 0) {
   setMonthBulletins([]);
   setAvailableStations([]);
   setSelectedStation("");
   setStationTrend([]);
   setTempTrendError(null);
   return;
  }
  let active = true;
  const loadTempTrend = async () => {
   try {
   const results = await Promise.all(
    dates.map(async (date) => {
     try {
     return await fetchBulletinByDate(date);
     } catch {
     return null;
     }
    }),
   );
   if (!active) return;
   const monthData = results
    .map((data, index) => (data ? { date: dates[index], data } : null))
    .filter(
     (item): item is { date: string; data: BulletinDetail } => Boolean(item?.data?.stations),
    );
   setMonthBulletins(monthData);

   const stationsMap = new Map<string, string>();
   monthData.forEach((entry) => {
    entry.data.stations.forEach((station) => {
     const rawName =
      station.name ??
      (station as { nom?: string | null }).nom ??
      "";
     const normalized = normalizeStationName(rawName);
     if (!normalized) return;
     if (!stationsMap.has(normalized)) {
      stationsMap.set(normalized, rawName);
     }
    });
   });

   const stationNames = Array.from(stationsMap.values()).sort((a, b) => a.localeCompare(b));
   setAvailableStations(stationNames);
   setSelectedStation((prev) => (prev && stationNames.includes(prev) ? prev : stationNames[0] ?? ""));
   setTempTrendError(null);
   } catch (err) {
   if (!active) return;
   console.error("Echec du chargement de la tendance temperature:", err);
   setTempTrendError("Echec du chargement des tendances temperature.");
   setMonthBulletins([]);
   setAvailableStations([]);
   setSelectedStation("");
   setStationTrend([]);
   }
  };
  loadTempTrend();
  return () => {
   active = false;
  };
 }, [availableDates, selectedMonth]);

 useEffect(() => {
  if (!selectedStation) {
   setStationTrend([]);
   return;
  }
  const normalized = normalizeStationName(selectedStation);
  const points = monthBulletins.map(({ date, data }) => {
   const station = data.stations.find((entry) => {
    const rawName =
     entry.name ??
     (entry as { nom?: string | null }).nom ??
     "";
    return normalizeStationName(rawName) === normalized;
   });
   return {
    date,
    tminObs: station?.tmin_obs ?? null,
    tminPrev: station?.tmin_prev ?? null,
    tmaxObs: station?.tmax_obs ?? null,
    tmaxPrev: station?.tmax_prev ?? null,
   };
  });
  setStationTrend(points);
 }, [monthBulletins, selectedStation]);

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
 const sampleSize = metrics?.sample_size ?? 0;
 const hasKpiData = sampleSize >= 2;

 const bulletinCount = bulletins.length;
 const observationCount = bulletins.filter((item) => item.type === "observation").length;
 const forecastCount = bulletins.filter((item) => item.type === "forecast").length;
 const pagesCount = bulletins.reduce((sum, item) => sum + (item.pages ?? 0), 0);
 const tminTrend = useMemo(
  () =>
   stationTrend.map((item) => ({
    date: item.date,
    obs: item.tminObs,
    prev: item.tminPrev,
   })),
  [stationTrend],
 );
 const tmaxTrend = useMemo(
  () =>
   stationTrend.map((item) => ({
    date: item.date,
    obs: item.tmaxObs,
    prev: item.tmaxPrev,
   })),
  [stationTrend],
 );
 const tminPointCount = useMemo(
  () => tminTrend.filter((item) => item.obs !== null || item.prev !== null).length,
  [tminTrend],
 );
 const tmaxPointCount = useMemo(
  () => tmaxTrend.filter((item) => item.obs !== null || item.prev !== null).length,
  [tmaxTrend],
 );

 const chartWidth = 640;
 const chartHeight = 220;
 const chartPadding = 28;
 const chartInnerWidth = chartWidth - chartPadding * 2;
 const chartInnerHeight = chartHeight - chartPadding * 2;
 const buildXTicks = (dates: string[]) =>
  dates.map((date, idx) => ({ label: date.slice(8, 10), index: idx }));
 const buildYTicks = (minValue: number, maxValue: number) => {
  if (minValue === maxValue) return [minValue];
  const start = Math.floor(minValue);
  const end = Math.ceil(maxValue);
  const ticks = [];
  for (let value = start; value <= end; value += 1) {
   ticks.push(value);
  }
  return ticks.length > 0 ? ticks : [minValue, maxValue];
 };
 const buildLinePath = (
  values: Array<number | null>,
  minValue: number,
  maxValue: number,
  count: number,
 ) => {
  const range = maxValue === minValue ? 1 : maxValue - minValue;
  const points = values
  .map((value, index) => {
   if (value === null || count < 2) return null;
   const x = chartPadding + (index / (count - 1)) * chartInnerWidth;
   const y =
   chartPadding + (1 - (value - minValue) / range) * chartInnerHeight;
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

 const tminValues = tminTrend.flatMap((item) =>
  [item.obs, item.prev].filter((value): value is number => typeof value === "number"),
 );
 const tmaxValues = tmaxTrend.flatMap((item) =>
  [item.obs, item.prev].filter((value): value is number => typeof value === "number"),
 );
 const tminMin = tminValues.length > 0 ? Math.min(...tminValues) : 0;
 const tminMax = tminValues.length > 0 ? Math.max(...tminValues) : 1;
 const tmaxMin = tmaxValues.length > 0 ? Math.min(...tmaxValues) : 0;
 const tmaxMax = tmaxValues.length > 0 ? Math.max(...tmaxValues) : 1;
 const tminRangeLabel =
  tminValues.length >= 2 ? `${tminMin.toFixed(0)}C - ${tminMax.toFixed(0)}C` : "--";
 const tmaxRangeLabel =
  tmaxValues.length >= 2 ? `${tmaxMin.toFixed(0)}C - ${tmaxMax.toFixed(0)}C` : "--";

 const tminObsPath = useMemo(
  () => buildLinePath(tminTrend.map((item) => item.obs), tminMin, tminMax, tminTrend.length),
  [tminTrend, tminMin, tminMax],
 );
 const tminPrevPath = useMemo(
  () => buildLinePath(tminTrend.map((item) => item.prev), tminMin, tminMax, tminTrend.length),
  [tminTrend, tminMin, tminMax],
 );
 const tmaxObsPath = useMemo(
  () => buildLinePath(tmaxTrend.map((item) => item.obs), tmaxMin, tmaxMax, tmaxTrend.length),
  [tmaxTrend, tmaxMin, tmaxMax],
 );
 const tmaxPrevPath = useMemo(
  () => buildLinePath(tmaxTrend.map((item) => item.prev), tmaxMin, tmaxMax, tmaxTrend.length),
  [tmaxTrend, tmaxMin, tmaxMax],
 );
 const tminTicksX = useMemo(() => buildXTicks(tminTrend.map((item) => item.date)), [tminTrend]);
 const tmaxTicksX = useMemo(() => buildXTicks(tmaxTrend.map((item) => item.date)), [tmaxTrend]);
 const tminTicksY = useMemo(() => buildYTicks(tminMin, tminMax), [tminMin, tminMax]);
 const tmaxTicksY = useMemo(() => buildYTicks(tmaxMin, tmaxMax), [tmaxMin, tmaxMax]);

 const yearlyContingency = useMemo(() => {
  const byYear = new Map<
   string,
   { labels: string[]; matrix: number[][]; index: Map<string, number> }
  >();
  const ensureLabel = (
   entry: { labels: string[]; matrix: number[][]; index: Map<string, number> },
   label: string,
  ) => {
   if (entry.index.has(label)) return;
   const nextIndex = entry.labels.length;
   entry.labels.push(label);
   entry.index.set(label, nextIndex);
   entry.matrix.forEach((row) => row.push(0));
   entry.matrix.push(new Array(entry.labels.length).fill(0));
  };
  const addMatrix = (
   entry: { labels: string[]; matrix: number[][]; index: Map<string, number> },
   labels: string[],
   matrix: number[][],
  ) => {
   labels.forEach((label) => ensureLabel(entry, label));
   labels.forEach((rowLabel, rowIdx) => {
    labels.forEach((colLabel, colIdx) => {
     const value = matrix[rowIdx]?.[colIdx] ?? 0;
     const r = entry.index.get(rowLabel);
     const c = entry.index.get(colLabel);
     if (r === undefined || c === undefined) return;
     entry.matrix[r][c] += value;
    });
   });
  };

  metricsHistory.forEach((item) => {
   if (!item?.date || !item.confusion_matrix?.labels || !item.confusion_matrix?.matrix) return;
   const year = item.date.slice(0, 4);
   const labels = item.confusion_matrix.labels;
   const matrix = item.confusion_matrix.matrix;
   if (!byYear.has(year)) {
    byYear.set(year, { labels: [], matrix: [], index: new Map() });
   }
   addMatrix(byYear.get(year)!, labels, matrix);
  });

  const years = Array.from(byYear.keys()).sort();
  const allLabelsSet = new Set<string>();
  years.forEach((year) => {
   const entry = byYear.get(year);
   if (!entry) return;
   entry.labels.forEach((label) => {
    if (label !== "UNK") {
     allLabelsSet.add(label);
    }
   });
  });
  const allLabels = Array.from(allLabelsSet).sort();

  const buildScores = (labels: string[], matrix: number[][]) => {
   const total = labels.reduce((sum, _, i) => {
    if (labels[i] === "UNK") return sum;
    return (
     sum +
     matrix[i].reduce((rowSum, value, j) => {
      if (labels[j] === "UNK") return rowSum;
      return rowSum + value;
     }, 0)
    );
   }, 0);
   const diag = labels.reduce((sum, _, i) => {
    if (labels[i] === "UNK") return sum;
    return sum + (matrix[i]?.[i] ?? 0);
   }, 0);
   const pc = total > 0 ? (diag / total) * 100 : null;
   const rows = allLabels.map((label) => {
    const idx = labels.indexOf(label);
    if (idx < 0) return { code: label, pod: null, far: null };
    const oi = matrix[idx].reduce((sum, value, j) => {
     if (labels[j] === "UNK") return sum;
     return sum + value;
    }, 0);
    const pi = matrix.reduce((sum, row, i) => {
     if (labels[i] === "UNK") return sum;
     return sum + (row[idx] ?? 0);
    }, 0);
    const nii = matrix[idx]?.[idx] ?? 0;
    const pod = oi > 0 ? nii / oi : null;
    const rel = pi > 0 ? nii / pi : null;
    const far = rel !== null ? 1 - rel : null;
    return { code: label, pod, far };
   });
   return { pc, rows };
  };

  const scoresByYear = years.map((year) => {
   const entry = byYear.get(year)!;
   return { year, scores: buildScores(entry.labels, entry.matrix) };
  });

  const globalEntry = { labels: [] as string[], matrix: [] as number[][], index: new Map<string, number>() };
  years.forEach((year) => {
   const entry = byYear.get(year);
   if (!entry) return;
   addMatrix(globalEntry, entry.labels, entry.matrix);
  });
  const globalScores = buildScores(globalEntry.labels, globalEntry.matrix);

  return { years, labels: allLabels, scoresByYear, globalScores };
 }, [metricsHistory]);

 const contingencyRows = useMemo(() => {
  const { labels, years, scoresByYear, globalScores } = yearlyContingency;
  const rows: Array<{ label: string; values: Array<number | null> }> = [];
  if (years.length === 0 || labels.length === 0) return rows;

  rows.push({
   label: "PC",
   values: [globalScores.pc, ...scoresByYear.map((year) => year.scores.pc)],
  });

  labels.forEach((label, idx) => {
   rows.push({
    label: `POD(${label})`,
    values: [
     globalScores.rows[idx]?.pod ?? null,
     ...scoresByYear.map((year) => year.scores.rows[idx]?.pod ?? null),
    ],
   });
  });

  labels.forEach((label, idx) => {
   rows.push({
    label: `FAR(${label})`,
    values: [
     globalScores.rows[idx]?.far ?? null,
     ...scoresByYear.map((year) => year.scores.rows[idx]?.far ?? null),
    ],
   });
  });

  return rows;
 }, [yearlyContingency]);

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

 const statusLabel = !isOnline
  ? "Deconnecte"
  : authStatus === "connected"
   ? "Connecte"
   : authStatus === "checking"
    ? "Verification..."
    : "Deconnecte";
 const statusClass = !isOnline
  ? "bg-amber-100 text-amber-700"
  : authStatus === "connected"
   ? "bg-emerald-100 text-emerald-700"
   : authStatus === "checking"
    ? "bg-blue-100 text-blue-700"
    : "bg-gray-100 text-gray-700";

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
                <span
                  className={`ml-auto inline-flex items-center gap-2 rounded-full px-3 py-1 text-[10px] font-semibold tracking-[0.25em] ${statusClass}`}
                >
                  <span
                    className={`h-2 w-2 rounded-full ${
                      authStatus === "connected" && isOnline
                        ? "bg-emerald-500"
                        : authStatus === "checking" && isOnline
                          ? "bg-blue-500"
                          : "bg-amber-500"
                    }`}
                  />
                  {statusLabel}
                  {authStatus === "connected" && authUser && (
                    <span className="tracking-normal uppercase text-xs text-ink/80">
                      {authUser}
                    </span>
                  )}
                </span>
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

      {!hasKpiData && (
        <div className="rounded-2xl border border-dashed border-[var(--border)] bg-[var(--canvas-strong)] p-4 text-sm text-muted">
          Données insuffisantes ({sampleSize} données).
        </div>
      )}
      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
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

       <section className="grid gap-6 lg:grid-cols-2">
         <div className="surface-panel p-6">
           <div className="flex flex-wrap items-center justify-between gap-3">
             <h3 className="text-lg font-semibold text-ink font-display">
               Tendance Tmin (Obs / Prév){selectedStation ? ` · ${selectedStation}` : ""}
             </h3>
             <div className="flex flex-wrap items-center gap-2">
               <select
                 className="rounded-full border border-[var(--border)] bg-[var(--canvas-strong)] px-3 py-1 text-xs font-medium text-ink focus:outline-none focus:ring-2 focus:ring-primary-500/30"
                 value={selectedStation}
                 onChange={(event) => setSelectedStation(event.target.value)}
                 disabled={availableStations.length === 0}
               >
                 {availableStations.length === 0 && <option value="">Aucune station</option>}
                 {availableStations.map((station) => (
                   <option key={station} value={station}>
                     {station}
                   </option>
                 ))}
               </select>
               <span className="rounded-full bg-primary-50 dark:bg-primary-900/20 px-3 py-1 text-xs font-medium text-primary-600 dark:text-primary-400">
                 {tminTrend.length} pts
               </span>
             </div>
           </div>
           <div className="mt-4 rounded-2xl border border-[var(--border)] bg-[var(--canvas-strong)] p-4">
             {tempTrendError ? (
               <p className="text-sm text-muted">{tempTrendError}</p>
             ) : tminPointCount < 2 ? (
               <div className="flex items-center justify-center py-10 text-center text-muted">
                 <div>
                   <span className="material-symbols-outlined text-4xl mb-2 text-primary-300">show_chart</span>
                   <p className="text-sm">Données insuffisantes ({tminPointCount} données).</p>
                 </div>
               </div>
             ) : (
               <div>
                 <div className="flex flex-wrap items-center gap-4 text-xs text-muted">
                   <span className="inline-flex items-center gap-2">
                     <span className="h-2.5 w-2.5 rounded-full bg-blue-500" />
                     Tmin Observée
                   </span>
                   <span className="inline-flex items-center gap-2">
                     <span className="h-2.5 w-2.5 rounded-full bg-blue-300" />
                     Tmin Prévue
                   </span>
                   <span className="ml-auto font-mono text-[11px]">{tminRangeLabel}</span>
                 </div>
                 <svg
                   className="mt-4 h-56 w-full"
                   viewBox={`0 0 ${chartWidth} ${chartHeight}`}
                   role="img"
                   aria-label="Tendance Tmin observee et prevue"
                 >
                   <defs>
                     <linearGradient id="tminObsGrad" x1="0" y1="0" x2="1" y2="0">
                       <stop offset="0%" stopColor="#2563EB" />
                       <stop offset="100%" stopColor="#1D4ED8" />
                     </linearGradient>
                     <linearGradient id="tminPrevGrad" x1="0" y1="0" x2="1" y2="0">
                       <stop offset="0%" stopColor="#60A5FA" />
                       <stop offset="100%" stopColor="#3B82F6" />
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
                 {tminTicksY.map((value) => {
                   const y =
                     chartPadding +
                     (1 - (value - tminMin) / (tminMax - tminMin || 1)) * chartInnerHeight;
                   return (
                     <g key={`tmin-y-${value}`}>
                       <line
                         x1={chartPadding}
                         x2={chartPadding + chartInnerWidth}
                         y1={y}
                         y2={y}
                         stroke="rgba(148,163,184,0.25)"
                         strokeDasharray="4 4"
                       />
                       <text
                         x={chartPadding - 6}
                         y={y + 4}
                         textAnchor="end"
                         className="fill-muted text-[10px] font-mono"
                       >
                         {value.toFixed(0)}
                       </text>
                     </g>
                   );
                 })}
                 <path
                   d={tminObsPath}
                   fill="none"
                   stroke="url(#tminObsGrad)"
                   strokeWidth={2.5}
                   strokeLinecap="round"
                 />
                  <path
                    d={tminPrevPath}
                    fill="none"
                    stroke="url(#tminPrevGrad)"
                    strokeWidth={2.5}
                    strokeLinecap="round"
                  />
                  {tminTrend.map((item, index) => {
                    const x =
                      chartPadding +
                      (index / Math.max(tminTrend.length - 1, 1)) * chartInnerWidth;
                    const obsY =
                      item.obs === null || item.obs === undefined
                        ? null
                        : chartPadding +
                          (1 - (item.obs - tminMin) / (tminMax - tminMin || 1)) * chartInnerHeight;
                    const prevY =
                      item.prev === null || item.prev === undefined
                        ? null
                        : chartPadding +
                          (1 - (item.prev - tminMin) / (tminMax - tminMin || 1)) * chartInnerHeight;
                    return (
                      <g key={`tmin-point-${item.date}-${index}`}>
                        {obsY !== null && (
                          <circle cx={x} cy={obsY} r={3.5} fill="#2563EB" />
                        )}
                        {prevY !== null && (
                          <circle cx={x} cy={prevY} r={3.5} fill="#60A5FA" />
                        )}
                      </g>
                    );
                  })}
                 {tminTicksX.map((tick) => {
                   const x =
                     chartPadding +
                     (tick.index / Math.max(tminTrend.length - 1, 1)) * chartInnerWidth;
                   return (
                     <g key={`tmin-x-${tick.index}`}>
                       <line
                         x1={x}
                         x2={x}
                         y1={chartPadding}
                         y2={chartPadding + chartInnerHeight}
                         stroke="rgba(148,163,184,0.2)"
                         strokeDasharray="4 4"
                       />
                       <text
                         x={x}
                         y={chartPadding + chartInnerHeight + 16}
                         textAnchor="middle"
                         className="fill-muted text-[10px] font-mono"
                       >
                         {tick.label}
                       </text>
                     </g>
                   );
                 })}
                 <text
                   x={chartPadding + chartInnerWidth / 2}
                   y={chartPadding + chartInnerHeight + 32}
                   textAnchor="middle"
                   className="fill-muted text-[10px]"
                 >
                   Jour
                 </text>
                 <text
                   x={chartPadding - 36}
                   y={chartPadding + chartInnerHeight / 2}
                   textAnchor="middle"
                   className="fill-muted text-[10px]"
                   transform={`rotate(-90 ${chartPadding - 36} ${chartPadding + chartInnerHeight / 2})`}
                 >
                   Temp (C)
                 </text>
                 </svg>
                 <div className="mt-2 flex justify-between text-[11px] text-muted font-mono">
                   <span>{tminTrend[0]?.date ?? ""}</span>
                   <span>{tminTrend[tminTrend.length - 1]?.date ?? ""}</span>
                 </div>
               </div>
             )}
           </div>
         </div>

         <div className="surface-panel p-6">
           <div className="flex items-center justify-between">
             <h3 className="text-lg font-semibold text-ink font-display">
               Tendance Tmax (Obs / Prév){selectedStation ? ` · ${selectedStation}` : ""}
             </h3>
             <span className="rounded-full bg-secondary-50 dark:bg-secondary-700/15 px-3 py-1 text-xs font-medium text-secondary-600 dark:text-secondary-400">
               {tmaxTrend.length} pts
             </span>
           </div>
           <div className="mt-4 rounded-2xl border border-[var(--border)] bg-[var(--canvas-strong)] p-4">
             {tempTrendError ? (
               <p className="text-sm text-muted">{tempTrendError}</p>
             ) : tmaxPointCount < 2 ? (
               <div className="flex items-center justify-center py-10 text-center text-muted">
                 <div>
                   <span className="material-symbols-outlined text-4xl mb-2 text-primary-300">show_chart</span>
                   <p className="text-sm">Données insuffisantes ({tmaxPointCount} données).</p>
                 </div>
               </div>
             ) : (
               <div>
                 <div className="flex flex-wrap items-center gap-4 text-xs text-muted">
                   <span className="inline-flex items-center gap-2">
                     <span className="h-2.5 w-2.5 rounded-full bg-red-500" />
                     Tmax Observée
                   </span>
                   <span className="inline-flex items-center gap-2">
                     <span className="h-2.5 w-2.5 rounded-full bg-red-300" />
                     Tmax Prévue
                   </span>
                   <span className="ml-auto font-mono text-[11px]">{tmaxRangeLabel}</span>
                 </div>
                 <svg
                   className="mt-4 h-56 w-full"
                   viewBox={`0 0 ${chartWidth} ${chartHeight}`}
                   role="img"
                   aria-label="Tendance Tmax observee et prevue"
                 >
                   <defs>
                     <linearGradient id="tmaxObsGrad" x1="0" y1="0" x2="1" y2="0">
                       <stop offset="0%" stopColor="#DC2626" />
                       <stop offset="100%" stopColor="#B91C1C" />
                     </linearGradient>
                     <linearGradient id="tmaxPrevGrad" x1="0" y1="0" x2="1" y2="0">
                       <stop offset="0%" stopColor="#FCA5A5" />
                       <stop offset="100%" stopColor="#F87171" />
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
                 {tmaxTicksY.map((value) => {
                   const y =
                     chartPadding +
                     (1 - (value - tmaxMin) / (tmaxMax - tmaxMin || 1)) * chartInnerHeight;
                   return (
                     <g key={`tmax-y-${value}`}>
                       <line
                         x1={chartPadding}
                         x2={chartPadding + chartInnerWidth}
                         y1={y}
                         y2={y}
                         stroke="rgba(148,163,184,0.25)"
                         strokeDasharray="4 4"
                       />
                       <text
                         x={chartPadding - 6}
                         y={y + 4}
                         textAnchor="end"
                         className="fill-muted text-[10px] font-mono"
                       >
                         {value.toFixed(0)}
                       </text>
                     </g>
                   );
                 })}
                 <path
                   d={tmaxObsPath}
                   fill="none"
                   stroke="url(#tmaxObsGrad)"
                   strokeWidth={2.5}
                   strokeLinecap="round"
                 />
                  <path
                    d={tmaxPrevPath}
                    fill="none"
                    stroke="url(#tmaxPrevGrad)"
                    strokeWidth={2.5}
                    strokeLinecap="round"
                  />
                  {tmaxTrend.map((item, index) => {
                    const x =
                      chartPadding +
                      (index / Math.max(tmaxTrend.length - 1, 1)) * chartInnerWidth;
                    const obsY =
                      item.obs === null || item.obs === undefined
                        ? null
                        : chartPadding +
                          (1 - (item.obs - tmaxMin) / (tmaxMax - tmaxMin || 1)) * chartInnerHeight;
                    const prevY =
                      item.prev === null || item.prev === undefined
                        ? null
                        : chartPadding +
                          (1 - (item.prev - tmaxMin) / (tmaxMax - tmaxMin || 1)) * chartInnerHeight;
                    return (
                      <g key={`tmax-point-${item.date}-${index}`}>
                        {obsY !== null && (
                          <circle cx={x} cy={obsY} r={3.5} fill="#DC2626" />
                        )}
                        {prevY !== null && (
                          <circle cx={x} cy={prevY} r={3.5} fill="#F87171" />
                        )}
                      </g>
                    );
                  })}
                 {tmaxTicksX.map((tick) => {
                   const x =
                     chartPadding +
                     (tick.index / Math.max(tmaxTrend.length - 1, 1)) * chartInnerWidth;
                   return (
                     <g key={`tmax-x-${tick.index}`}>
                       <line
                         x1={x}
                         x2={x}
                         y1={chartPadding}
                         y2={chartPadding + chartInnerHeight}
                         stroke="rgba(148,163,184,0.2)"
                         strokeDasharray="4 4"
                       />
                       <text
                         x={x}
                         y={chartPadding + chartInnerHeight + 16}
                         textAnchor="middle"
                         className="fill-muted text-[10px] font-mono"
                       >
                         {tick.label}
                       </text>
                     </g>
                   );
                 })}
                 <text
                   x={chartPadding + chartInnerWidth / 2}
                   y={chartPadding + chartInnerHeight + 32}
                   textAnchor="middle"
                   className="fill-muted text-[10px]"
                 >
                   Jour
                 </text>
                 <text
                   x={chartPadding - 36}
                   y={chartPadding + chartInnerHeight / 2}
                   textAnchor="middle"
                   className="fill-muted text-[10px]"
                   transform={`rotate(-90 ${chartPadding - 36} ${chartPadding + chartInnerHeight / 2})`}
                 >
                   Temp (C)
                 </text>
                 </svg>
                 <div className="mt-2 flex justify-between text-[11px] text-muted font-mono">
                   <span>{tmaxTrend[0]?.date ?? ""}</span>
                   <span>{tmaxTrend[tmaxTrend.length - 1]?.date ?? ""}</span>
                 </div>
               </div>
             )}
           </div>
         </div>
       </section>

       <section className="surface-panel p-6">
         <div className="flex items-center justify-between">
           <h3 className="text-lg font-semibold text-ink font-display">
             Table de contingence par année
           </h3>
           <h3 className="rounded-full bg-secondary-50 dark:bg-secondary-700/15 px-3 py-1 font-medium text-secondary-600 dark:text-secondary-400">
             Qualité Globale de Prévision  
             <b> {quality?.average_quality?.toFixed(2) || '-'}</b> 
           </h3>
         </div>
         <div className="mt-4 overflow-x-auto">
           {trendError ? (
             <p className="text-sm text-muted">{trendError}</p>
           ) : contingencyRows.length === 0 ? (
             <div className="rounded-2xl border border-dashed border-[var(--border)] bg-[var(--canvas-strong)] p-6 text-center">
               <span className="material-symbols-outlined text-3xl text-primary-300 mb-2">table_rows</span>
               <p className="text-sm text-muted">
                 Données insuffisantes ({metricsHistory.length} données).
               </p>
             </div>
           ) : (
             <table className="min-w-full text-xs">
               <thead>
                 <tr className="text-left text-muted">
                   <th className="py-2 pr-2">Scores</th>
                   <th className="py-2 px-2 text-center font-semibold">Global</th>
                   {yearlyContingency.years.map((year) => (
                     <th key={year} className="py-2 px-2 text-center font-semibold">
                       {year}
                     </th>
                   ))}
                 </tr>
               </thead>
               <tbody>
                 {contingencyRows.map((row) => (
                   <tr key={row.label} className="border-t border-[var(--border)]">
                     <td className="py-2 pr-2 font-semibold text-ink whitespace-nowrap">
                       {row.label}
                     </td>
                     {row.values.map((value, idx) => (
                       <td key={`${row.label}-${idx}`} className="py-2 px-2 text-center font-mono">
                         {value === null || Number.isNaN(value) ? "--" : value.toFixed(2)}
                      </td>
                    ))}
                   </tr>
                 ))}
               </tbody>
             </table>
           )}
         </div>
       </section>
     </div>
   </Layout>
 );
}
