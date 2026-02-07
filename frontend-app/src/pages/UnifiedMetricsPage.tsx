import { useEffect, useMemo, useState } from "react";
import { Layout } from "../components/Layout";
import { MonthlyMetricsContent } from "../components/MonthlyMetricsContent";
import { JsonMetricsContent } from "../components/JsonMetricsContent";
import { ErrorPanel, LoadingPanel } from "../components/StatusPanel";
import {
  fetchContingencyMetrics,
  fetchMonthlyMetricsList,
  fetchStationsWithMetrics,
  recalculateMetrics,
  type ContingencyResponse,
  type MonthlyMetricsResponse,
  type StationInfo,
} from "../services/api";

const viewOptions = [
  { value: "base", label: "Base de donnees" },
  { value: "manual", label: "Import manuel" },
] as const;

type ViewOption = (typeof viewOptions)[number]["value"];

type ContingencyFilters = {
  year: string;
  month: string;
  stationId: string;
};

const DEFAULT_CONTINGENCY_FILTERS: ContingencyFilters = {
  year: "all",
  month: "all",
  stationId: "all",
};

const MONTHS = [
  "Janvier",
  "Fevrier",
  "Mars",
  "Avril",
  "Mai",
  "Juin",
  "Juillet",
  "Aout",
  "Septembre",
  "Octobre",
  "Novembre",
  "Decembre",
];

const SEASONS = [
  { key: "rainy", label: "Saison pluvieuse (Juin-Sep)", months: [6, 7, 8, 9] },
  { key: "dry", label: "Saison seche (Oct-Mai)", months: [10, 11, 12, 1, 2, 3, 4, 5] },
] as const;

type AggregatedMetrics = {
  label: string;
  sample_size: number;
  days_evaluated: number;
  mae_tmin: number | null;
  mae_tmax: number | null;
  rmse_tmin: number | null;
  rmse_tmax: number | null;
  bias_tmin: number | null;
  bias_tmax: number | null;
  accuracy_weather: number | null;
  precision_weather: number | null;
  recall_weather: number | null;
  f1_score_weather: number | null;
};

const formatNumber = (value?: number | null, digits = 2) => {
  if (value === null || value === undefined || Number.isNaN(value)) return "--";
  return value.toFixed(digits);
};

const formatPercent = (value?: number | null) => {
  if (value === null || value === undefined || Number.isNaN(value)) return "--";
  return `${(value * 100).toFixed(1)}%`;
};

const formatPc = (value?: number | null) => {
  if (value === null || value === undefined || Number.isNaN(value)) return "--";
  return `${value.toFixed(1)}%`;
};

const toCsvValue = (value: string | number | null | undefined) => {
  if (value === null || value === undefined) return "";
  const text = String(value);
  if (/[",\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
};

const buildCsv = (rows: Array<Array<string | number | null | undefined>>) => {
  return rows.map((row) => row.map(toCsvValue).join(",")).join("\n");
};

const downloadCsv = (filename: string, rows: Array<Array<string | number | null | undefined>>) => {
  const blob = new Blob([buildCsv(rows)], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
};

const getWeight = (item: MonthlyMetricsResponse) => {
  const sample = item.sample_size ?? 0;
  const days = item.days_evaluated ?? 0;
  return sample > 0 ? sample : days;
};

const weightedAverage = (items: MonthlyMetricsResponse[], key: keyof MonthlyMetricsResponse) => {
  let sum = 0;
  let weightSum = 0;
  items.forEach((item) => {
    const value = item[key];
    const weight = getWeight(item);
    if (value === null || value === undefined || Number.isNaN(value) || weight <= 0) return;
    sum += value * weight;
    weightSum += weight;
  });
  return weightSum > 0 ? sum / weightSum : null;
};

const aggregateMetrics = (label: string, items: MonthlyMetricsResponse[]): AggregatedMetrics => {
  const sample_size = items.reduce((acc, item) => acc + (item.sample_size ?? 0), 0);
  const days_evaluated = items.reduce((acc, item) => acc + (item.days_evaluated ?? 0), 0);
  return {
    label,
    sample_size,
    days_evaluated,
    mae_tmin: weightedAverage(items, "mae_tmin"),
    mae_tmax: weightedAverage(items, "mae_tmax"),
    rmse_tmin: weightedAverage(items, "rmse_tmin"),
    rmse_tmax: weightedAverage(items, "rmse_tmax"),
    bias_tmin: weightedAverage(items, "bias_tmin"),
    bias_tmax: weightedAverage(items, "bias_tmax"),
    accuracy_weather: weightedAverage(items, "accuracy_weather"),
    precision_weather: weightedAverage(items, "precision_weather"),
    recall_weather: weightedAverage(items, "recall_weather"),
    f1_score_weather: weightedAverage(items, "f1_score_weather"),
  };
};

export function UnifiedMetricsPage() {
  const [activeView, setActiveView] = useState<ViewOption>("base");
  const [contingency, setContingency] = useState<ContingencyResponse | null>(null);
  const [contingencyLoading, setContingencyLoading] = useState(false);
  const [contingencyError, setContingencyError] = useState<string | null>(null);
  const [contingencyFilters, setContingencyFilters] = useState<ContingencyFilters>(
    DEFAULT_CONTINGENCY_FILTERS,
  );
  const [stations, setStations] = useState<StationInfo[]>([]);
  const [metricsLoading, setMetricsLoading] = useState(false);
  const [metricsError, setMetricsError] = useState<string | null>(null);
  const [monthlyMetrics, setMonthlyMetrics] = useState<MonthlyMetricsResponse[]>([]);
  const [manualCalcLoading, setManualCalcLoading] = useState(false);
  const [manualCalcMessage, setManualCalcMessage] = useState<string | null>(null);

  useEffect(() => {
    fetchStationsWithMetrics()
      .then((payload) => setStations(payload.stations ?? []))
      .catch(() => setStations([]));
  }, []);

  const loadMonthlyMetrics = async () => {
    try {
      setMetricsLoading(true);
      setMetricsError(null);
      const payload = await fetchMonthlyMetricsList(60);
      setMonthlyMetrics(payload.items ?? []);
    } catch (err) {
      setMonthlyMetrics([]);
      setMetricsError(err instanceof Error ? err.message : "Pas de metriques disponibles.");
    } finally {
      setMetricsLoading(false);
    }
  };

  useEffect(() => {
    loadMonthlyMetrics();
  }, []);

  const loadContingency = async (filters: ContingencyFilters) => {
    try {
      setContingencyLoading(true);
      setContingencyError(null);
      const payload = await fetchContingencyMetrics({
        year: filters.year !== "all" ? Number(filters.year) : undefined,
        month: filters.month !== "all" ? Number(filters.month) : undefined,
        stationId: filters.stationId !== "all" ? Number(filters.stationId) : undefined,
      });
      setContingency(payload);
    } catch (err) {
      setContingency(null);
      setContingencyError(
        err instanceof Error ? err.message : "Impossible de charger la contingence.",
      );
    } finally {
      setContingencyLoading(false);
    }
  };

  useEffect(() => {
    loadContingency(contingencyFilters);
  }, [contingencyFilters]);

  const availableYears = useMemo(() => {
    const years = new Set<number>();
    monthlyMetrics.forEach((metric) => years.add(metric.year));
    return Array.from(years).sort((a, b) => b - a);
  }, [monthlyMetrics]);

  const contingencySummary = useMemo(() => {
    if (!contingency) return [];
    const labels = contingency.labels ?? [];
    const matrix = contingency.matrix ?? [];
    const rowSums = labels.map((_, rowIdx) =>
      (matrix[rowIdx] ?? []).reduce((acc, value) => acc + (value ?? 0), 0),
    );
    const colSums = labels.map((_, colIdx) =>
      matrix.reduce((acc, row) => acc + ((row?.[colIdx] ?? 0) as number), 0),
    );
    const hits = labels.map((_, idx) => (matrix[idx]?.[idx] ?? 0) as number);
    return labels.map((label, idx) => {
      const score = contingency.rows?.find((row) => row.code === label);
      return {
        label,
        obs: rowSums[idx] ?? 0,
        prev: colSums[idx] ?? 0,
        hits: hits[idx] ?? 0,
        pod: score?.pod ?? null,
        far: score?.far ?? null,
      };
    });
  }, [contingency]);

  const maxPhenomena = useMemo(() => {
    return contingencySummary.reduce(
      (acc, item) => Math.max(acc, item.obs ?? 0, item.prev ?? 0),
      1,
    );
  }, [contingencySummary]);

  const yearlyAggregates = useMemo(() => {
    const groups = new Map<number, MonthlyMetricsResponse[]>();
    monthlyMetrics.forEach((metric) => {
      const list = groups.get(metric.year) ?? [];
      list.push(metric);
      groups.set(metric.year, list);
    });
    return Array.from(groups.entries())
      .sort(([a], [b]) => b - a)
      .map(([year, items]) => aggregateMetrics(String(year), items));
  }, [monthlyMetrics]);

  const seasonalAggregates = useMemo(() => {
    const groups = new Map<string, MonthlyMetricsResponse[]>();
    monthlyMetrics.forEach((metric) => {
      SEASONS.forEach((season) => {
        if (season.months.includes(metric.month)) {
          const key = `${metric.year}-${season.key}`;
          const list = groups.get(key) ?? [];
          list.push(metric);
          groups.set(key, list);
        }
      });
    });
    return Array.from(groups.entries())
      .map(([key, items]) => {
        const [year, seasonKey] = key.split("-");
        const seasonLabel = SEASONS.find((season) => season.key === seasonKey)?.label ?? seasonKey;
        return aggregateMetrics(`${seasonLabel} ${year}`, items);
      })
      .sort((a, b) => b.label.localeCompare(a.label));
  }, [monthlyMetrics]);

  const exportContingencyCsv = () => {
    if (!contingency) {
      setContingencyError("Aucune contingence a exporter.");
      return;
    }
    const rows: Array<Array<string | number | null | undefined>> = [];
    rows.push([
      "phenomene",
      "observations",
      "previsions",
      "hits",
      "pod",
      "far",
      "pc",
      "sample_size",
      "days_count",
      "year",
      "month",
      "station_id",
    ]);
    const year = contingency.filters?.year ?? "";
    const month = contingency.filters?.month ?? "";
    const stationId = contingency.filters?.station_id ?? "";
    contingencySummary.forEach((row) => {
      rows.push([
        row.label,
        row.obs,
        row.prev,
        row.hits,
        row.pod ?? "",
        row.far ?? "",
        contingency.pc ?? "",
        contingency.sample_size ?? "",
        contingency.days_count ?? "",
        year,
        month,
        stationId,
      ]);
    });
    const stamp = new Date().toISOString().slice(0, 10);
    downloadCsv(`contingence-${stamp}.csv`, rows);
  };

  const exportAggregatesCsv = () => {
    const rows: Array<Array<string | number | null | undefined>> = [];
    rows.push([
      "type",
      "label",
      "sample_size",
      "days_evaluated",
      "mae_tmin",
      "mae_tmax",
      "rmse_tmin",
      "rmse_tmax",
      "bias_tmin",
      "bias_tmax",
      "accuracy_weather",
      "precision_weather",
      "recall_weather",
      "f1_score_weather",
    ]);
    yearlyAggregates.forEach((row) => {
      rows.push([
        "annuel",
        row.label,
        row.sample_size,
        row.days_evaluated,
        row.mae_tmin,
        row.mae_tmax,
        row.rmse_tmin,
        row.rmse_tmax,
        row.bias_tmin,
        row.bias_tmax,
        row.accuracy_weather,
        row.precision_weather,
        row.recall_weather,
        row.f1_score_weather,
      ]);
    });
    seasonalAggregates.forEach((row) => {
      rows.push([
        "saisonnier",
        row.label,
        row.sample_size,
        row.days_evaluated,
        row.mae_tmin,
        row.mae_tmax,
        row.rmse_tmin,
        row.rmse_tmax,
        row.bias_tmin,
        row.bias_tmax,
        row.accuracy_weather,
        row.precision_weather,
        row.recall_weather,
        row.f1_score_weather,
      ]);
    });
    const stamp = new Date().toISOString().slice(0, 10);
    downloadCsv(`agregats-meteo-${stamp}.csv`, rows);
  };

  const handleManualRecalculate = async () => {
    try {
      setManualCalcLoading(true);
      setManualCalcMessage(null);
      const result = await recalculateMetrics(true);
      if (result.status === "no_data") {
        setManualCalcMessage(result.message ?? "Aucune donnee pour recalculer.");
      } else {
        const monthsAgg = result.result?.monthly?.months_aggregated ?? 0;
        setManualCalcMessage(`Recalcul termine : ${monthsAgg} mois agreges.`);
        await loadMonthlyMetrics();
      }
    } catch (err) {
      console.error("Echec du recalcul:", err);
      setManualCalcMessage("Echec du recalcul des metriques.");
    } finally {
      setManualCalcLoading(false);
    }
  };

  return (
    <Layout title="Metriques unifiees">
      <div className="space-y-6">
        <div className="surface-panel p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-ink">Metriques unifiees</h2>
              <p className="text-sm text-muted">
                Vue base: metriques calculees depuis la base. Vue manuelle: import et calcul.
              </p>
            </div>
            <div className="inline-flex rounded-full border border-[var(--border)] bg-[var(--canvas-strong)] p-1">
              {viewOptions.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setActiveView(option.value)}
                  className={`rounded-full px-4 py-2 text-xs font-semibold transition ${
                    activeView === option.value
                      ? "bg-primary-600 text-white shadow"
                      : "text-ink hover:bg-[var(--surface)]"
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {activeView === "base" && (
          <div className="space-y-6">
            <MonthlyMetricsContent />

            <div className="surface-panel p-6 space-y-4">
              <div>
                <h3 className="text-lg font-semibold text-ink">Table de contingence</h3>
                <p className="text-sm text-muted">
                  Par station et phenomene, avec POD/FAR et matrice complete.
                </p>
              </div>
              <div className="flex flex-wrap items-end gap-3">
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-semibold text-muted" htmlFor="cont-year">
                    Annee
                  </label>
                  <select
                    id="cont-year"
                    value={contingencyFilters.year}
                    onChange={(event) =>
                      setContingencyFilters((prev) => ({ ...prev, year: event.target.value }))
                    }
                    className="min-w-[120px] rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"
                  >
                    <option value="all">Toutes</option>
                    {availableYears.map((year) => (
                      <option key={year} value={year}>
                        {year}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-semibold text-muted" htmlFor="cont-month">
                    Mois
                  </label>
                  <select
                    id="cont-month"
                    value={contingencyFilters.month}
                    onChange={(event) =>
                      setContingencyFilters((prev) => ({ ...prev, month: event.target.value }))
                    }
                    className="min-w-[140px] rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"
                  >
                    <option value="all">Tous</option>
                    {MONTHS.map((label, index) => (
                      <option key={label} value={index + 1}>
                        {label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-semibold text-muted" htmlFor="cont-station">
                    Station
                  </label>
                  <select
                    id="cont-station"
                    value={contingencyFilters.stationId}
                    onChange={(event) =>
                      setContingencyFilters((prev) => ({ ...prev, stationId: event.target.value }))
                    }
                    className="min-w-[220px] rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"
                  >
                    <option value="all">Toutes</option>
                    {stations.map((station) => (
                      <option key={station.id} value={station.id}>
                        {station.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="text-xs text-muted ml-auto">
                  {contingency?.sample_size ?? 0} echantillons, {contingency?.days_count ?? 0} jours
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={exportContingencyCsv}
                    className="rounded-full border border-[var(--border)] px-3 py-2 text-xs font-semibold text-ink hover:bg-[var(--canvas-strong)]"
                  >
                    Export CSV contingence
                  </button>
                </div>
              </div>

              {contingencyLoading && <LoadingPanel message="Chargement de la contingence..." />}
              {contingencyError && !contingencyLoading && (
                <ErrorPanel
                  message={contingencyError}
                  onRetry={() => loadContingency(contingencyFilters)}
                />
              )}

              {!contingencyLoading && contingency && (
                <div className="grid gap-6 lg:grid-cols-2">
                  <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
                    <div className="flex items-center justify-between mb-3">
                      <h4 className="text-sm font-semibold text-ink">Matrice de contingence</h4>
                      <span className="text-xs text-muted">PC: {formatPc(contingency.pc)}</span>
                    </div>
                    <div className="overflow-auto">
                      <table className="w-full text-left text-sm">
                        <thead className="text-xs uppercase tracking-[0.2em] text-muted">
                          <tr>
                            <th className="px-2 py-2">Obs \ Prev</th>
                            {contingency.labels.map((label) => (
                              <th key={label} className="px-2 py-2 text-center">
                                {label}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[var(--border)]">
                          {contingency.labels.map((rowLabel, rowIdx) => (
                            <tr key={rowLabel}>
                              <td className="px-2 py-2 font-semibold text-ink">{rowLabel}</td>
                              {contingency.labels.map((colLabel, colIdx) => {
                                const value = contingency.matrix?.[rowIdx]?.[colIdx] ?? 0;
                                const highlight = rowIdx === colIdx;
                                return (
                                  <td
                                    key={`${rowLabel}-${colLabel}`}
                                    className={`px-2 py-2 text-center text-xs ${
                                      highlight ? "bg-emerald-50 text-emerald-700" : "text-muted"
                                    }`}
                                  >
                                    {value}
                                  </td>
                                );
                              })}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 space-y-5">
                    <div>
                      <h4 className="text-sm font-semibold text-ink">POD / FAR par phenomene</h4>
                      <p className="text-xs text-muted">
                        POD = taux de detection. FAR = taux d'alarme fausse.
                      </p>
                    </div>
                    <div className="overflow-auto">
                      <table className="w-full text-left text-sm">
                        <thead className="text-xs uppercase tracking-[0.2em] text-muted">
                          <tr>
                            <th className="px-2 py-2">Phenomenes</th>
                            <th className="px-2 py-2 text-right">POD</th>
                            <th className="px-2 py-2 text-right">FAR</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[var(--border)]">
                          {contingencySummary.map((row) => (
                            <tr key={row.label}>
                              <td className="px-2 py-2 font-semibold text-ink">{row.label}</td>
                              <td className="px-2 py-2 text-right text-xs text-muted">
                                {formatPercent(row.pod)}
                              </td>
                              <td className="px-2 py-2 text-right text-xs text-muted">
                                {formatPercent(row.far)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    <div>
                      <div className="flex items-center justify-between">
                        <div>
                          <h4 className="text-sm font-semibold text-ink">Phenomenes prevus</h4>
                          <p className="text-xs text-muted">Volumes prevus vs observes</p>
                        </div>
                        <div className="flex items-center gap-3 text-xs text-muted">
                          <span className="inline-flex items-center gap-1">
                            <span className="size-2 rounded-full bg-emerald-500" />
                            Prev
                          </span>
                          <span className="inline-flex items-center gap-1">
                            <span className="size-2 rounded-full bg-blue-500" />
                            Obs
                          </span>
                        </div>
                      </div>
                      <div className="mt-4 space-y-4">
                        {contingencySummary.map((row) => (
                          <div key={`${row.label}-chart`} className="space-y-2">
                            <div className="flex items-center justify-between text-xs text-muted">
                              <span className="font-semibold text-ink">{row.label}</span>
                              <span>
                                Prev {row.prev} | Obs {row.obs}
                              </span>
                            </div>
                            <div className="flex items-center gap-2">
                              <div className="h-3 flex-1 rounded-full bg-[var(--canvas-strong)] overflow-hidden">
                                <div
                                  className="h-full bg-emerald-500/80"
                                  style={{ width: `${(row.prev / maxPhenomena) * 100}%` }}
                                />
                              </div>
                              <span className="text-[11px] text-muted w-10 text-right">
                                {row.prev}
                              </span>
                            </div>
                            <div className="flex items-center gap-2">
                              <div className="h-3 flex-1 rounded-full bg-[var(--canvas-strong)] overflow-hidden">
                                <div
                                  className="h-full bg-blue-500/80"
                                  style={{ width: `${(row.obs / maxPhenomena) * 100}%` }}
                                />
                              </div>
                              <span className="text-[11px] text-muted w-10 text-right">
                                {row.obs}
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div className="surface-panel p-6 space-y-4">
              <div>
                <h3 className="text-lg font-semibold text-ink">Vues annuelles et saisonnieres</h3>
                <p className="text-sm text-muted">
                  Aggregation a partir des metriques mensuelles.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={exportAggregatesCsv}
                  className="rounded-full border border-[var(--border)] px-3 py-2 text-xs font-semibold text-ink hover:bg-[var(--canvas-strong)]"
                >
                  Export CSV agregats
                </button>
              </div>

              {metricsLoading && <LoadingPanel message="Chargement des metriques..." />}
              {metricsError && !metricsLoading && (
                <ErrorPanel message={metricsError} onRetry={loadMonthlyMetrics} />
              )}

              {!metricsLoading && !metricsError && (
                <div className="grid gap-6 lg:grid-cols-2">
                  <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
                    <h4 className="text-sm font-semibold text-ink mb-3">Vue annuelle</h4>
                    <div className="overflow-auto">
                      <table className="w-full text-left text-sm">
                        <thead className="text-xs uppercase tracking-[0.2em] text-muted">
                          <tr>
                            <th className="px-2 py-2">Annee</th>
                            <th className="px-2 py-2 text-right">MAE Tmin</th>
                            <th className="px-2 py-2 text-right">MAE Tmax</th>
                            <th className="px-2 py-2 text-right">Accuracy</th>
                            <th className="px-2 py-2 text-right">Echantillon</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[var(--border)]">
                          {yearlyAggregates.map((row) => (
                            <tr key={row.label}>
                              <td className="px-2 py-2 font-semibold text-ink">{row.label}</td>
                              <td className="px-2 py-2 text-right text-xs text-muted">
                                {formatNumber(row.mae_tmin)}
                              </td>
                              <td className="px-2 py-2 text-right text-xs text-muted">
                                {formatNumber(row.mae_tmax)}
                              </td>
                              <td className="px-2 py-2 text-right text-xs text-muted">
                                {formatPercent(row.accuracy_weather)}
                              </td>
                              <td className="px-2 py-2 text-right text-xs text-muted">
                                {row.sample_size}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
                    <h4 className="text-sm font-semibold text-ink mb-3">Vue saisonniere</h4>
                    <div className="overflow-auto">
                      <table className="w-full text-left text-sm">
                        <thead className="text-xs uppercase tracking-[0.2em] text-muted">
                          <tr>
                            <th className="px-2 py-2">Saison</th>
                            <th className="px-2 py-2 text-right">MAE Tmin</th>
                            <th className="px-2 py-2 text-right">MAE Tmax</th>
                            <th className="px-2 py-2 text-right">Accuracy</th>
                            <th className="px-2 py-2 text-right">Echantillon</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[var(--border)]">
                          {seasonalAggregates.map((row) => (
                            <tr key={row.label}>
                              <td className="px-2 py-2 font-semibold text-ink">{row.label}</td>
                              <td className="px-2 py-2 text-right text-xs text-muted">
                                {formatNumber(row.mae_tmin)}
                              </td>
                              <td className="px-2 py-2 text-right text-xs text-muted">
                                {formatNumber(row.mae_tmax)}
                              </td>
                              <td className="px-2 py-2 text-right text-xs text-muted">
                                {formatPercent(row.accuracy_weather)}
                              </td>
                              <td className="px-2 py-2 text-right text-xs text-muted">
                                {row.sample_size}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {activeView === "manual" && (
          <div className="surface-panel p-6">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-ink">Import manuel JSON/CSV</h3>
              <span className="text-xs text-muted">Visualisation et calcul</span>
            </div>
            <div className="mb-4 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={handleManualRecalculate}
                disabled={manualCalcLoading}
                className="rounded-full border border-[var(--border)] bg-[var(--canvas-strong)] px-4 py-2 text-xs font-semibold text-ink hover:bg-[var(--surface)] disabled:opacity-60"
              >
                {manualCalcLoading ? "Calcul en cours..." : "Calculer les metriques importees"}
              </button>
              {manualCalcMessage && (
                <span className="text-xs text-muted">{manualCalcMessage}</span>
              )}
            </div>
            <JsonMetricsContent showInsertButton />
          </div>
        )}
      </div>
    </Layout>
  );
}
