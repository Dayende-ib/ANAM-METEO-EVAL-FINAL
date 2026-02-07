import { useEffect, useMemo, useState } from "react";
import {
  fetchJsonMetricsFile,
  fetchJsonMetricsFiles,
  ingestManualMetrics,
  type JsonMetricsFileInfo,
  type JsonMetricsFilePayload,
  type ManualMetricsEntry,
  type ManualMetricsStation,
} from "../services/api";
import { ErrorPanel, LoadingPanel } from "./StatusPanel";

type JsonMetricsContentProps = {
  showInsertButton?: boolean;
};

type CachedPayloads = Record<string, JsonMetricsFilePayload>;

const DEFAULT_SOURCE = "json-metrics";

function normalizeMapType(value?: string | null) {
  if (!value) return null;
  const lowered = value.toLowerCase();
  if (lowered === "observed") return "observation";
  if (lowered === "forecast") return "forecast";
  return lowered;
}

function buildEntry(
  info: JsonMetricsFileInfo,
  payload: JsonMetricsFilePayload,
): ManualMetricsEntry | null {
  if (!info.date) return null;
  const mapType = normalizeMapType(info.map_type ?? payload.data?.map_type) ?? null;
  if (!mapType) return null;
  const stations: ManualMetricsStation[] = (payload.data?.stations ?? [])
    .filter((station) => station.nom)
    .map((station) => ({
      nom: station.nom ?? undefined,
      tmin: station.tmin ?? null,
      tmax: station.tmax ?? null,
      weather_icon: station.weather_icon ?? null,
    }));
  return {
    date: info.date,
    mapType,
    source: payload.data?.source_image ?? info.name,
    stations,
  };
}

export function JsonMetricsContent({ showInsertButton = true }: JsonMetricsContentProps) {
  const [files, setFiles] = useState<JsonMetricsFileInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [monthFilter, setMonthFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [selectedPaths, setSelectedPaths] = useState<string[]>([]);
  const [activePath, setActivePath] = useState<string | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [detailPayload, setDetailPayload] = useState<JsonMetricsFilePayload | null>(null);
  const [payloadCache, setPayloadCache] = useState<CachedPayloads>({});
  const [importing, setImporting] = useState(false);
  const [importMessage, setImportMessage] = useState<string | null>(null);
  const [importErrors, setImportErrors] = useState<string[]>([]);

  const uniqueMonths = useMemo(() => {
    const months = files
      .map((file) => file.month)
      .filter((value): value is string => Boolean(value));
    return Array.from(new Set(months)).sort();
  }, [files]);

  const filteredFiles = useMemo(() => {
    const query = search.trim().toLowerCase();
    return files.filter((file) => {
      if (monthFilter !== "all" && file.month !== monthFilter) return false;
      if (typeFilter !== "all" && file.map_type !== typeFilter) return false;
      if (!query) return true;
      return (
        file.name.toLowerCase().includes(query) ||
        file.path.toLowerCase().includes(query) ||
        (file.date ?? "").includes(query)
      );
    });
  }, [files, monthFilter, typeFilter, search]);

  const loadFiles = async () => {
    try {
      setLoading(true);
      const payload = await fetchJsonMetricsFiles();
      setFiles(payload.files ?? []);
      setError(null);
    } catch (err) {
      console.error("Failed to load json metrics files:", err);
      setFiles([]);
      setError("Failed to load json metrics files.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadFiles();
  }, []);

  const toggleSelect = (path: string) => {
    setSelectedPaths((prev) => {
      if (prev.includes(path)) {
        return prev.filter((item) => item !== path);
      }
      return [...prev, path];
    });
  };

  const selectAll = () => {
    setSelectedPaths(filteredFiles.map((file) => file.path));
  };

  const clearSelection = () => {
    setSelectedPaths([]);
  };

  const openDetails = async (path: string) => {
    setActivePath(path);
    setDetailError(null);
    if (payloadCache[path]) {
      setDetailPayload(payloadCache[path]);
      return;
    }
    try {
      setDetailLoading(true);
      const payload = await fetchJsonMetricsFile(path);
      setPayloadCache((prev) => ({ ...prev, [path]: payload }));
      setDetailPayload(payload);
    } catch (err) {
      console.error("Failed to load json metrics file:", err);
      setDetailPayload(null);
      setDetailError("Failed to load the selected JSON file.");
    } finally {
      setDetailLoading(false);
    }
  };

  const buildEntries = async () => {
    const errors: string[] = [];
    const entries: ManualMetricsEntry[] = [];

    for (const path of selectedPaths) {
      const info = files.find((file) => file.path === path);
      if (!info) {
        errors.push(`Unknown file: ${path}`);
        continue;
      }
      let payload = payloadCache[path];
      if (!payload) {
        try {
          payload = await fetchJsonMetricsFile(path);
          setPayloadCache((prev) => ({ ...prev, [path]: payload }));
        } catch {
          errors.push(`Failed to fetch ${path}`);
          continue;
        }
      }
      const entry = buildEntry(info, payload);
      if (!entry) {
        errors.push(`Skipping ${info.name} (missing date or map type)`);
        continue;
      }
      entries.push(entry);
    }

    return { entries, errors };
  };

  const handleImport = async () => {
    if (selectedPaths.length === 0) {
      setImportMessage("Select at least one file to import.");
      return;
    }
    try {
      setImporting(true);
      setImportMessage(null);
      setImportErrors([]);

      const { entries, errors } = await buildEntries();
      if (entries.length === 0) {
        setImportErrors(errors);
        setImportMessage("No valid entries to import.");
        return;
      }

      const result = await ingestManualMetrics({
        source: DEFAULT_SOURCE,
        entries,
      });
      const message = [
        `Imported: ${result.inserted_bulletins} new bulletins.`,
        `Updated: ${result.updated_payloads} payloads.`,
        `Skipped: ${result.skipped} entries.`,
      ].join(" ");
      setImportMessage(message);
      setImportErrors(errors);
    } catch (err) {
      console.error("Failed to ingest manual metrics:", err);
      setImportMessage("Failed to ingest json metrics.");
    } finally {
      setImporting(false);
    }
  };

  if (loading) {
    return <LoadingPanel message="Loading json metrics files..." />;
  }

  if (error) {
    return <ErrorPanel message={error} onRetry={loadFiles} />;
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <label className="text-xs font-semibold text-muted" htmlFor="json-search">
            Search
          </label>
          <input
            id="json-search"
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search by filename or date..."
            className="min-w-[220px] rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-ink outline-none focus:ring-2 focus:ring-primary/40"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-semibold text-muted" htmlFor="month-filter">
            Month
          </label>
          <select
            id="month-filter"
            value={monthFilter}
            onChange={(event) => setMonthFilter(event.target.value)}
            className="min-w-[160px] rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-ink outline-none focus:ring-2 focus:ring-primary/40"
          >
            <option value="all">All months</option>
            {uniqueMonths.map((month) => (
              <option key={month} value={month}>
                {month}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-semibold text-muted" htmlFor="type-filter">
            Type
          </label>
          <select
            id="type-filter"
            value={typeFilter}
            onChange={(event) => setTypeFilter(event.target.value)}
            className="min-w-[140px] rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-ink outline-none focus:ring-2 focus:ring-primary/40"
          >
            <option value="all">All</option>
            <option value="observed">Observed</option>
            <option value="forecast">Forecast</option>
          </select>
        </div>
        <div className="flex items-center gap-2 pb-1">
          <button
            type="button"
            onClick={selectAll}
            className="rounded-xl border border-[var(--border)] bg-[var(--canvas-strong)] px-3 py-2 text-xs font-semibold text-ink transition hover:bg-[var(--surface)]"
          >
            Select all
          </button>
          <button
            type="button"
            onClick={clearSelection}
            className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-xs font-semibold text-muted transition hover:bg-[var(--canvas-strong)]"
          >
            Clear
          </button>
          <button
            type="button"
            onClick={loadFiles}
            className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-xs font-semibold text-muted transition hover:bg-[var(--canvas-strong)]"
          >
            Refresh
          </button>
        </div>
        {showInsertButton && (
          <div className="ml-auto flex items-center gap-2 pb-1">
            <button
              type="button"
              onClick={handleImport}
              disabled={importing || selectedPaths.length === 0}
              className="rounded-xl bg-primary-600 px-4 py-2 text-xs font-semibold text-white transition hover:bg-primary-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {importing ? "Importing..." : "Import selection"}
            </button>
          </div>
        )}
      </div>

      {importMessage && (
        <div className="rounded-2xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-700">
          {importMessage}
        </div>
      )}
      {importErrors.length > 0 && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700 space-y-1">
          {importErrors.map((message, idx) => (
            <div key={idx}>{message}</div>
          ))}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[1.1fr_1fr]">
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 shadow-lg">
          <div className="mb-3 flex items-center justify-between">
            <h4 className="text-sm font-semibold text-ink">Files</h4>
            <span className="text-xs text-muted">
              {filteredFiles.length} / {files.length}
            </span>
          </div>
          <div className="max-h-[420px] overflow-y-auto space-y-2 pr-2">
            {filteredFiles.length === 0 && (
              <p className="text-sm text-muted">No json metrics file found.</p>
            )}
            {filteredFiles.map((file) => {
              const isSelected = selectedPaths.includes(file.path);
              const isActive = activePath === file.path;
              return (
                <div
                  key={file.path}
                  className={`flex items-center gap-3 rounded-xl border px-3 py-2 text-sm transition ${
                    isActive
                      ? "border-primary-500 bg-primary-50"
                      : "border-[var(--border)] bg-[var(--surface-strong)]"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => toggleSelect(file.path)}
                    className="size-4"
                  />
                  <button
                    type="button"
                    onClick={() => openDetails(file.path)}
                    className="flex-1 text-left"
                  >
                    <div className="font-semibold text-ink">{file.name}</div>
                    <div className="text-xs text-muted">
                      {file.date ?? "Unknown date"} {file.map_type ? `- ${file.map_type}` : ""}
                    </div>
                  </button>
                </div>
              );
            })}
          </div>
        </div>

        <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 shadow-lg">
          <div className="mb-3 flex items-center justify-between">
            <h4 className="text-sm font-semibold text-ink">Preview</h4>
            <span className="text-xs text-muted">{activePath ?? "Select a file"}</span>
          </div>
          {detailLoading && <LoadingPanel message="Loading file details..." />}
          {detailError && <ErrorPanel message={detailError} onRetry={() => activePath && openDetails(activePath)} />}
          {!detailLoading && !detailError && !detailPayload && (
            <p className="text-sm text-muted">Select a file to preview its content.</p>
          )}
          {detailPayload && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3 text-xs text-muted">
                <div>
                  <div className="font-semibold text-ink">Date</div>
                  <div>{detailPayload.data?.date_bulletin ?? "Unknown"}</div>
                </div>
                <div>
                  <div className="font-semibold text-ink">Map type</div>
                  <div>{detailPayload.data?.map_type ?? "Unknown"}</div>
                </div>
                <div>
                  <div className="font-semibold text-ink">Source</div>
                  <div className="truncate">{detailPayload.data?.source_image ?? "-"}</div>
                </div>
                <div>
                  <div className="font-semibold text-ink">Stations</div>
                  <div>{detailPayload.data?.stations?.length ?? 0}</div>
                </div>
              </div>
              <div className="max-h-56 overflow-y-auto rounded-xl border border-[var(--border)] bg-[var(--canvas-strong)] p-3 text-xs">
                <table className="w-full text-left text-xs">
                  <thead className="text-muted">
                    <tr>
                      <th className="py-1 pr-2">Station</th>
                      <th className="py-1 pr-2">Tmin</th>
                      <th className="py-1 pr-2">Tmax</th>
                      <th className="py-1 pr-2">Weather</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(detailPayload.data?.stations ?? []).map((station, idx) => (
                      <tr key={`${station.nom}-${idx}`} className="border-t border-[var(--border)]">
                        <td className="py-1 pr-2 font-semibold text-ink">{station.nom ?? "-"}</td>
                        <td className="py-1 pr-2 text-muted">{station.tmin ?? "-"}</td>
                        <td className="py-1 pr-2 text-muted">{station.tmax ?? "-"}</td>
                        <td className="py-1 pr-2 text-muted">{station.weather_icon ?? "-"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <details className="rounded-xl border border-[var(--border)] bg-[var(--surface-strong)] p-3 text-xs text-muted">
                <summary className="cursor-pointer font-semibold text-ink">Raw JSON</summary>
                <pre className="mt-2 whitespace-pre-wrap break-words">
                  {JSON.stringify(detailPayload.data, null, 2)}
                </pre>
              </details>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
