import { useEffect, useMemo, useState } from "react";
import { Layout } from "../components/Layout";
import { ErrorPanel, LoadingPanel } from "../components/StatusPanel";
import {
  fetchStationData,
  fetchStationDataFilters,
  fetchStationDataHistory,
  updateStationDataRow,
  downloadStationDataCsv,
  fetchAuthMe,
  getAuthToken,
  type StationDataHistoryItem,
  type StationDataRow,
} from "../services/api";

type FilterState = {
  year: string;
  month: string;
  station: string;
  mapType: string;
};

type DraftState = {
  tmin: string;
  tmax: string;
  weather_condition: string;
  reason: string;
};

type ColumnKey =
  | "year"
  | "month"
  | "day"
  | "localites"
  | "previsions"
  | "observations"
  | "tmin_prev"
  | "tmax_prev"
  | "tmin_obs"
  | "tmax_obs"
  | "tmin_ecart_abs"
  | "tmax_ecart_abs";

const DEFAULT_FILTERS: FilterState = {
  year: "all",
  month: "all",
  station: "all",
  mapType: "all",
};

const USER_KEY = "station-data-user";
const COLUMN_KEY = "station-data-columns";

const COLUMN_DEFS: Array<{ key: ColumnKey; label: string }> = [
  { key: "year", label: "Annee" },
  { key: "month", label: "Mois" },
  { key: "day", label: "Jour" },
  { key: "localites", label: "Localites" },
  { key: "previsions", label: "Previsions" },
  { key: "observations", label: "Observations" },
  { key: "tmin_prev", label: "Tmin prev" },
  { key: "tmax_prev", label: "Tmax prev" },
  { key: "tmin_obs", label: "Tmin obs" },
  { key: "tmax_obs", label: "Tmax obs" },
  { key: "tmin_ecart_abs", label: "Tmin ecart abs" },
  { key: "tmax_ecart_abs", label: "Tmax ecart abs" },
];

const DEFAULT_VISIBLE_COLUMNS: ColumnKey[] = [
  "year",
  "month",
  "day",
  "localites",
  "previsions",
  "observations",
  "tmin_prev",
  "tmax_prev",
  "tmin_obs",
  "tmax_obs",
];

export function StationDataPage() {
  const [filters, setFilters] = useState<FilterState>(DEFAULT_FILTERS);
  const [years, setYears] = useState<number[]>([]);
  const [months, setMonths] = useState<number[]>([]);
  const [stations, setStations] = useState<string[]>([]);
  const [rows, setRows] = useState<StationDataRow[]>([]);
  const [total, setTotal] = useState(0);
  const [limit] = useState(50);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<StationDataHistoryItem[]>([]);
  const [historyTotal, setHistoryTotal] = useState(0);
  const [editingRowId, setEditingRowId] = useState<number | null>(null);
  const [draft, setDraft] = useState<DraftState>({
    tmin: "",
    tmax: "",
    weather_condition: "",
    reason: "",
  });
  const [message, setMessage] = useState<string | null>(null);
  const [messageType, setMessageType] = useState<"success" | "error" | "info">("info");
  const [userName, setUserName] = useState(() => localStorage.getItem(USER_KEY) ?? "");
  const [authUser, setAuthUser] = useState<string | null>(null);
  const [visibleColumns, setVisibleColumns] = useState<ColumnKey[]>(() => {
    if (typeof window === "undefined") {
      return DEFAULT_VISIBLE_COLUMNS;
    }
    try {
      const raw = window.localStorage.getItem(COLUMN_KEY);
      if (!raw) return DEFAULT_VISIBLE_COLUMNS;
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return DEFAULT_VISIBLE_COLUMNS;
      const valid = parsed.filter((key) => COLUMN_DEFS.some((col) => col.key === key));
      return valid.length ? (valid as ColumnKey[]) : DEFAULT_VISIBLE_COLUMNS;
    } catch {
      return DEFAULT_VISIBLE_COLUMNS;
    }
  });

  const hasFilters = useMemo(() => {
    return filters.year !== "all" || filters.month !== "all" || filters.station !== "all";
  }, [filters]);

  const parsedFilters = useMemo(() => {
    return {
      year: filters.year !== "all" ? Number(filters.year) : undefined,
      month: filters.month !== "all" ? Number(filters.month) : undefined,
      station: filters.station !== "all" ? filters.station : undefined,
      mapType: filters.mapType !== "all" ? (filters.mapType as "observation" | "forecast") : undefined,
    };
  }, [filters]);

  const loadFilters = async () => {
    try {
      const payload = await fetchStationDataFilters();
      setYears(payload.years ?? []);
      setMonths(payload.months ?? []);
      setStations(payload.stations ?? []);
    } catch (err) {
      console.error("Failed to load station data filters:", err);
    }
  };

  const loadRows = async () => {
    try {
      setLoading(true);
      setError(null);
      const payload = await fetchStationData({
        ...parsedFilters,
        limit,
        offset,
      });
      setRows(payload.items ?? []);
      setTotal(payload.total ?? 0);
    } catch (err) {
      console.error("Failed to load station data:", err);
      setError("Impossible de charger les donnees des stations.");
      setRows([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  };

  const loadHistory = async () => {
    try {
      setHistoryLoading(true);
      const payload = await fetchStationDataHistory({
        ...parsedFilters,
        limit: 50,
        offset: 0,
      });
      setHistory(payload.items ?? []);
      setHistoryTotal(payload.total ?? 0);
    } catch (err) {
      console.error("Failed to load station data history:", err);
      setHistory([]);
      setHistoryTotal(0);
    } finally {
      setHistoryLoading(false);
    }
  };

  useEffect(() => {
    loadFilters();
  }, []);

  useEffect(() => {
    const token = getAuthToken();
    if (!token) return;
    fetchAuthMe()
      .then((payload) => {
        setAuthUser(payload.username);
        setUserName(payload.username);
      })
      .catch(() => {
        setAuthUser(null);
      });
  }, []);

  useEffect(() => {
    setOffset(0);
  }, [filters]);

  useEffect(() => {
    loadRows();
    loadHistory();
  }, [parsedFilters, offset]);

  useEffect(() => {
    if (!authUser) {
      localStorage.setItem(USER_KEY, userName);
    }
  }, [userName, authUser]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(COLUMN_KEY, JSON.stringify(visibleColumns));
  }, [visibleColumns]);

  const startEdit = (row: StationDataRow) => {
    setEditingRowId(row.id);
    setDraft({
      tmin: row.tmin !== null && row.tmin !== undefined ? String(row.tmin) : "",
      tmax: row.tmax !== null && row.tmax !== undefined ? String(row.tmax) : "",
      weather_condition: row.weather_condition ?? "",
      reason: "",
    });
    setMessage(null);
  };

  const cancelEdit = () => {
    setEditingRowId(null);
    setDraft({ tmin: "", tmax: "", weather_condition: "", reason: "" });
  };

  const parseNumber = (value: string) => {
    if (!value.trim()) return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  };

  const formatNumber = (value?: number | null) => {
    if (value === null || value === undefined || Number.isNaN(value)) {
      return "--";
    }
    return Number.isInteger(value) ? value.toString() : value.toFixed(1);
  };

  const pairIndex = useMemo(() => {
    const map = new Map<string, { forecast?: StationDataRow; observation?: StationDataRow }>();
    rows.forEach((row) => {
      const key = `${row.date}|${row.station_id}`;
      const entry = map.get(key) ?? {};
      if (row.map_type === "forecast") {
        entry.forecast = row;
      } else {
        entry.observation = row;
      }
      map.set(key, entry);
    });
    return map;
  }, [rows]);

  const orderedColumns = useMemo(() => {
    return COLUMN_DEFS.filter((column) => visibleColumns.includes(column.key));
  }, [visibleColumns]);

  const toggleColumn = (key: ColumnKey) => {
    setVisibleColumns((prev) =>
      prev.includes(key) ? prev.filter((col) => col !== key) : [...prev, key],
    );
  };

  const resetColumns = () => {
    setVisibleColumns(DEFAULT_VISIBLE_COLUMNS);
  };

  const saveEdit = async (row: StationDataRow) => {
    try {
      setMessage(null);
      const payload = {
        tmin: parseNumber(draft.tmin),
        tmax: parseNumber(draft.tmax),
        weather_condition: draft.weather_condition.trim() || null,
        user: (authUser ?? userName).trim() || "unknown",
        reason: draft.reason.trim() || undefined,
      };
      const response = await updateStationDataRow(row.id, payload);
      if (response.updated && response.row) {
        setRows((current) =>
          current.map((item) => (item.id === row.id ? { ...item, ...response.row } : item)),
        );
        setMessageType("success");
        setMessage("Mise a jour effectuee.");
        await loadHistory();
      } else {
        setMessageType("info");
        setMessage("Aucun changement detecte.");
      }
      cancelEdit();
    } catch (err) {
      console.error("Failed to update station data:", err);
      setMessageType("error");
      setMessage("Echec de la mise a jour.");
    }
  };

  const exportCsv = async () => {
    try {
      const blob = await downloadStationDataCsv(parsedFilters);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `station-data-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      setMessageType("success");
      setMessage("Export CSV genere.");
    } catch (err) {
      console.error("Failed to export CSV:", err);
      setMessageType("error");
      setMessage("Impossible d'exporter le CSV.");
    }
  };

  if (loading && rows.length === 0) {
    return (
      <Layout title="Donnees stations">
        <LoadingPanel message="Chargement des donnees..." />
      </Layout>
    );
  }

  if (error) {
    return (
      <Layout title="Donnees stations">
        <ErrorPanel message={error} onRetry={loadRows} />
      </Layout>
    );
  }

  return (
    <Layout title="Donnees stations">
      <div className="space-y-6">
        <div className="surface-panel p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-ink">Tableau des donnees extraites</h2>
              <p className="text-sm text-muted">
                Filtrer par annee, mois ou station et exporter les resultats en CSV.
              </p>
            </div>
            <button
              type="button"
              onClick={exportCsv}
              className="rounded-full bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-700 transition-colors"
            >
              Exporter CSV
            </button>
          </div>

          <div className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-xs font-semibold text-muted" htmlFor="filter-year">
                Annee
              </label>
              <select
                id="filter-year"
                value={filters.year}
                onChange={(event) => setFilters((prev) => ({ ...prev, year: event.target.value }))}
                className="min-w-[120px] rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"
              >
                <option value="all">Toutes</option>
                {years.map((year) => (
                  <option key={year} value={year}>
                    {year}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-semibold text-muted" htmlFor="filter-month">
                Mois
              </label>
              <select
                id="filter-month"
                value={filters.month}
                onChange={(event) => setFilters((prev) => ({ ...prev, month: event.target.value }))}
                className="min-w-[120px] rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"
              >
                <option value="all">Tous</option>
                {months.map((month) => (
                  <option key={month} value={month}>
                    {month.toString().padStart(2, "0")}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-semibold text-muted" htmlFor="filter-station">
                Station
              </label>
              <select
                id="filter-station"
                value={filters.station}
                onChange={(event) => setFilters((prev) => ({ ...prev, station: event.target.value }))}
                className="min-w-[200px] rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"
              >
                <option value="all">Toutes</option>
                {stations.map((station) => (
                  <option key={station} value={station}>
                    {station}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-semibold text-muted" htmlFor="filter-type">
                Type
              </label>
              <select
                id="filter-type"
                value={filters.mapType}
                onChange={(event) => setFilters((prev) => ({ ...prev, mapType: event.target.value }))}
                className="min-w-[140px] rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"
              >
                <option value="all">Tous</option>
                <option value="observation">Observation</option>
                <option value="forecast">Prevision</option>
              </select>
            </div>
            <div className="flex flex-col gap-1 ml-auto">
              <label className="text-xs font-semibold text-muted" htmlFor="filter-user">
                Utilisateur {authUser ? "(auth)" : ""}
              </label>
              <input
                id="filter-user"
                value={authUser ?? userName}
                onChange={(event) => setUserName(event.target.value)}
                placeholder="Nom pour l'historique"
                disabled={Boolean(authUser)}
                className="min-w-[200px] rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"
              />
            </div>
          </div>

          <div className="flex flex-wrap items-start gap-3">
            <details className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3">
              <summary className="cursor-pointer text-xs font-semibold text-muted uppercase tracking-[0.2em]">
                Colonnes
              </summary>
              <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {COLUMN_DEFS.map((column) => (
                  <label key={column.key} className="flex items-center gap-2 text-xs text-ink">
                    <input
                      type="checkbox"
                      checked={visibleColumns.includes(column.key)}
                      onChange={() => toggleColumn(column.key)}
                      className="size-4 rounded border border-[var(--border)]"
                    />
                    {column.label}
                  </label>
                ))}
              </div>
              <div className="mt-3 flex items-center gap-2">
                <button
                  type="button"
                  onClick={resetColumns}
                  className="rounded-full border border-[var(--border)] px-3 py-1 text-xs text-muted hover:bg-[var(--canvas-strong)]"
                >
                  Par defaut
                </button>
              </div>
            </details>
          </div>

          {message && (
            <div
              className={`rounded-2xl border px-4 py-3 text-sm ${
                messageType === "success"
                  ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                  : messageType === "error"
                    ? "border-red-200 bg-red-50 text-red-700"
                    : "border-blue-200 bg-blue-50 text-blue-700"
              }`}
            >
              {message}
            </div>
          )}
        </div>

        <div className="surface-panel overflow-hidden">
          <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border)] bg-[var(--canvas-strong)]">
            <div>
              <h3 className="text-lg font-semibold text-ink">Donnees stations</h3>
              <p className="text-xs text-muted">
                {total} ligne(s) {hasFilters ? "(filtrees)" : ""}
              </p>
            </div>
            <div className="flex items-center gap-2 text-xs text-muted">
              <span className="material-symbols-outlined text-base">table_chart</span>
              Extraction OCR
            </div>
          </div>
          <div className="max-h-[620px] overflow-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-[var(--surface)]/70 text-xs uppercase tracking-[0.2em] text-muted sticky top-0">
                <tr>
                  {orderedColumns.map((column) => (
                    <th
                      key={column.key}
                      className={`px-4 py-3 ${
                        column.key.includes("tmin") || column.key.includes("tmax") ? "text-right" : ""
                      }`}
                    >
                      {column.label}
                    </th>
                  ))}
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {rows.length === 0 && (
                  <tr>
                    <td className="px-6 py-6 text-sm text-muted" colSpan={orderedColumns.length + 1}>
                      Aucune donnee pour ces filtres.
                    </td>
                  </tr>
                )}
                {rows.map((row) => {
                  const isEditing = editingRowId === row.id;
                  const isForecast = row.map_type === "forecast";
                  const key = `${row.date}|${row.station_id}`;
                  const pair = pairIndex.get(key);
                  const forecast = pair?.forecast;
                  const observation = pair?.observation;
                  const dateParts = row.date.split("-");
                  const year = dateParts[0] ?? "--";
                  const month = dateParts[1] ?? "--";
                  const day = dateParts[2] ?? "--";
                  const tminEcart =
                    forecast?.tmin !== null &&
                    forecast?.tmin !== undefined &&
                    observation?.tmin !== null &&
                    observation?.tmin !== undefined
                      ? Math.abs(forecast.tmin - observation.tmin)
                      : null;
                  const tmaxEcart =
                    forecast?.tmax !== null &&
                    forecast?.tmax !== undefined &&
                    observation?.tmax !== null &&
                    observation?.tmax !== undefined
                      ? Math.abs(forecast.tmax - observation.tmax)
                      : null;
                  return (
                    <tr key={row.id} className="hover:bg-[var(--canvas-strong)]">
                      {orderedColumns.map((column) => {
                        switch (column.key) {
                          case "year":
                            return (
                              <td key={column.key} className="px-4 py-3 font-medium text-ink">
                                {year}
                              </td>
                            );
                          case "month":
                            return (
                              <td key={column.key} className="px-4 py-3 text-ink">
                                {month}
                              </td>
                            );
                          case "day":
                            return (
                              <td key={column.key} className="px-4 py-3 text-ink">
                                {day}
                              </td>
                            );
                          case "localites":
                            return (
                              <td key={column.key} className="px-4 py-3 font-semibold text-ink">
                                {row.station_name}
                              </td>
                            );
                          case "previsions":
                            return (
                              <td key={column.key} className="px-4 py-3">
                                {isEditing && isForecast ? (
                                  <input
                                    value={draft.weather_condition}
                                    onChange={(event) =>
                                      setDraft((prev) => ({ ...prev, weather_condition: event.target.value }))
                                    }
                                    className="w-full rounded border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-xs"
                                  />
                                ) : (
                                  <span className="text-xs text-muted">
                                    {forecast?.weather_condition ?? "--"}
                                  </span>
                                )}
                                {isEditing && isForecast && (
                                  <input
                                    value={draft.reason}
                                    onChange={(event) =>
                                      setDraft((prev) => ({ ...prev, reason: event.target.value }))
                                    }
                                    placeholder="Raison (optionnelle)"
                                    className="mt-2 w-full rounded border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-xs"
                                  />
                                )}
                              </td>
                            );
                          case "observations":
                            return (
                              <td key={column.key} className="px-4 py-3">
                                {isEditing && !isForecast ? (
                                  <input
                                    value={draft.weather_condition}
                                    onChange={(event) =>
                                      setDraft((prev) => ({ ...prev, weather_condition: event.target.value }))
                                    }
                                    className="w-full rounded border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-xs"
                                  />
                                ) : (
                                  <span className="text-xs text-muted">
                                    {observation?.weather_condition ?? "--"}
                                  </span>
                                )}
                                {isEditing && !isForecast && (
                                  <input
                                    value={draft.reason}
                                    onChange={(event) =>
                                      setDraft((prev) => ({ ...prev, reason: event.target.value }))
                                    }
                                    placeholder="Raison (optionnelle)"
                                    className="mt-2 w-full rounded border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-xs"
                                  />
                                )}
                              </td>
                            );
                          case "tmin_prev":
                            return (
                              <td key={column.key} className="px-4 py-3 text-right font-mono">
                                {isEditing && isForecast ? (
                                  <input
                                    value={draft.tmin}
                                    onChange={(event) =>
                                      setDraft((prev) => ({ ...prev, tmin: event.target.value }))
                                    }
                                    className="w-20 rounded border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-xs"
                                  />
                                ) : (
                                  formatNumber(forecast?.tmin)
                                )}
                              </td>
                            );
                          case "tmax_prev":
                            return (
                              <td key={column.key} className="px-4 py-3 text-right font-mono">
                                {isEditing && isForecast ? (
                                  <input
                                    value={draft.tmax}
                                    onChange={(event) =>
                                      setDraft((prev) => ({ ...prev, tmax: event.target.value }))
                                    }
                                    className="w-20 rounded border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-xs"
                                  />
                                ) : (
                                  formatNumber(forecast?.tmax)
                                )}
                              </td>
                            );
                          case "tmin_obs":
                            return (
                              <td key={column.key} className="px-4 py-3 text-right font-mono">
                                {isEditing && !isForecast ? (
                                  <input
                                    value={draft.tmin}
                                    onChange={(event) =>
                                      setDraft((prev) => ({ ...prev, tmin: event.target.value }))
                                    }
                                    className="w-20 rounded border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-xs"
                                  />
                                ) : (
                                  formatNumber(observation?.tmin)
                                )}
                              </td>
                            );
                          case "tmax_obs":
                            return (
                              <td key={column.key} className="px-4 py-3 text-right font-mono">
                                {isEditing && !isForecast ? (
                                  <input
                                    value={draft.tmax}
                                    onChange={(event) =>
                                      setDraft((prev) => ({ ...prev, tmax: event.target.value }))
                                    }
                                    className="w-20 rounded border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-xs"
                                  />
                                ) : (
                                  formatNumber(observation?.tmax)
                                )}
                              </td>
                            );
                          case "tmin_ecart_abs":
                            return (
                              <td key={column.key} className="px-4 py-3 text-right font-mono">
                                {formatNumber(tminEcart)}
                              </td>
                            );
                          case "tmax_ecart_abs":
                            return (
                              <td key={column.key} className="px-4 py-3 text-right font-mono">
                                {formatNumber(tmaxEcart)}
                              </td>
                            );
                          default:
                            return null;
                        }
                      })}
                      <td className="px-4 py-3 text-right">
                        {isEditing ? (
                          <div className="flex justify-end gap-2">
                            <button
                              type="button"
                              onClick={() => saveEdit(row)}
                              className="rounded-full bg-emerald-600 px-3 py-1 text-xs font-semibold text-white"
                            >
                              Sauver
                            </button>
                            <button
                              type="button"
                              onClick={cancelEdit}
                              className="rounded-full border border-[var(--border)] px-3 py-1 text-xs text-muted"
                            >
                              Annuler
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => startEdit(row)}
                            className="rounded-full border border-[var(--border)] px-3 py-1 text-xs text-ink hover:bg-[var(--canvas-strong)]"
                          >
                            {row.map_type === "forecast" ? "Modifier prevision" : "Modifier observation"}
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between px-6 py-4 border-t border-[var(--border)] text-xs text-muted">
            <span>
              Page {Math.floor(offset / limit) + 1} sur {Math.max(1, Math.ceil(total / limit))}
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={offset === 0}
                onClick={() => setOffset((prev) => Math.max(0, prev - limit))}
                className="rounded-full border border-[var(--border)] px-3 py-1 text-xs disabled:opacity-40"
              >
                Precedent
              </button>
              <button
                type="button"
                disabled={offset + limit >= total}
                onClick={() => setOffset((prev) => prev + limit)}
                className="rounded-full border border-[var(--border)] px-3 py-1 text-xs disabled:opacity-40"
              >
                Suivant
              </button>
            </div>
          </div>
        </div>

        <div className="surface-panel p-6">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h3 className="text-lg font-semibold text-ink">Historique des modifications</h3>
              <p className="text-xs text-muted">{historyTotal} changement(s)</p>
            </div>
            {historyLoading && (
              <span className="text-xs text-muted">Chargement...</span>
            )}
          </div>
          <div className="max-h-[320px] overflow-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs uppercase tracking-[0.2em] text-muted">
                <tr>
                  <th className="px-3 py-2">Date</th>
                  <th className="px-3 py-2">Station</th>
                  <th className="px-3 py-2">Type</th>
                  <th className="px-3 py-2">Champ</th>
                  <th className="px-3 py-2">Ancien</th>
                  <th className="px-3 py-2">Nouveau</th>
                  <th className="px-3 py-2">Par</th>
                  <th className="px-3 py-2">Raison</th>
                  <th className="px-3 py-2">Quand</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {history.length === 0 && (
                  <tr>
                    <td colSpan={9} className="px-3 py-4 text-sm text-muted">
                      Aucun historique pour ces filtres.
                    </td>
                  </tr>
                )}
                {history.map((item) => (
                  <tr key={item.id}>
                    <td className="px-3 py-2 text-xs text-muted">{item.date ?? "--"}</td>
                    <td className="px-3 py-2 text-xs font-semibold text-ink">
                      {item.station_name ?? "--"}
                    </td>
                    <td className="px-3 py-2 text-xs text-muted">{item.map_type ?? "--"}</td>
                    <td className="px-3 py-2 text-xs text-muted">{item.field}</td>
                    <td className="px-3 py-2 text-xs text-muted">{String(item.old_value ?? "--")}</td>
                    <td className="px-3 py-2 text-xs text-muted">{String(item.new_value ?? "--")}</td>
                    <td className="px-3 py-2 text-xs text-muted">{item.updated_by ?? "--"}</td>
                    <td className="px-3 py-2 text-xs text-muted">{item.reason ?? "--"}</td>
                    <td className="px-3 py-2 text-xs text-muted">
                      {item.updated_at ? new Date(item.updated_at).toLocaleString("fr-FR") : "--"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </Layout>
  );
}
