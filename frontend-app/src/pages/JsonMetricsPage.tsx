import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { Layout } from "../components/Layout";
import { ErrorPanel, LoadingPanel } from "../components/StatusPanel";
import {
  fetchJsonMetricsFile,
  fetchJsonMetricsFiles,
  type JsonMetricsFileInfo,
  type JsonMetricsFilePayload,
} from "../services/api";

type JsonStation = {
  nom?: string | null;
  tmin?: number | null;
  tmax?: number | null;
  weather_icon?: string | null;
};

type JsonEntry = {
  date: string;
  mapType: string;
  stations: JsonStation[];
  source: string;
};

type CsvRow = Record<string, string>;

type StationPair = {
  date: string;
  station: string;
  tminObs: number | null;
  tmaxObs: number | null;
  tminFore: number | null;
  tmaxFore: number | null;
  weatherObs: string | null;
  weatherFore: string | null;
};

type TemperatureMetrics = {
  mae_tmin?: number | null;
  mae_tmax?: number | null;
  rmse_tmin?: number | null;
  rmse_tmax?: number | null;
  bias_tmin?: number | null;
  bias_tmax?: number | null;
  temperature_sample_size?: number | null;
};

type WeatherMetrics = {
  accuracy_weather?: number | null;
  precision_weather?: number | null;
  recall_weather?: number | null;
  f1_score_weather?: number | null;
  weather_sample_size?: number | null;
  confusion_matrix?: {
    labels: string[];
    matrix: number[][];
  } | null;
};

type MetricsResult = TemperatureMetrics & WeatherMetrics;

type MetricsMode = "station" | "month" | "year";

const MODE_LABELS: Record<MetricsMode, string> = {
  station: "Par station",
  month: "Par mois",
  year: "Par année",
};

const formatNumber = (value?: number | null, decimals = 2) => {
  if (typeof value !== "number" || Number.isNaN(value)) return "--";
  return value.toFixed(decimals);
};

const formatScore = (value?: number | null, decimals = 3) => {
  if (typeof value !== "number" || Number.isNaN(value)) return "--";
  return value.toFixed(decimals);
};

const normalizeStation = (name?: string | null) => (name ?? "").trim();
const normalizeIconKey = (label?: string | null) =>
  (label ?? "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

const ICON_NAME_TO_CODE: Record<string, string> = {
  // Pictogrammes météo standards
  "orages avec pluies isoles": "TSRA",
  "orages avec pluies isolés": "TSRA",
  "orages avec pluies": "TSRA",
  "pluies orageuses isolees": "TSRA",
  "pluies orageuses isolées": "TSRA",
  "pluie orageuse": "TSRA",
  "pluie": "RA",
  "pluies": "RA",
  "orage": "TS",
  "orages": "TS",
  "orages isoles": "TS",
  "orages isolés": "TS",
  "temps partiellement nuageux": "NSW",
  "temps nuageux": "NSW",
  "temps ensoleille": "NSW",
  "temps ensoleillé": "NSW",
  "ciel couvert": "NSW",
  "ciel dégagé": "NSW",
  "nuageux": "NSW",
  "ensoleillé": "NSW",
  "ensoleille": "NSW",
  "partiellement_nuageux": "NSW",
  
  // Pictogrammes avec poussière
  "orages avec pluies isoles avec poussiere": "DUTSRA",
  "orages avec pluies isolés avec poussière": "DUTSRA",
  "pluies avec poussiere": "DURA",
  "pluies avec poussière": "DURA",
  "orages isoles avec poussiere": "DUTS",
  "orages isolés avec poussière": "DUTS",
  "orages avec poussiere": "DUTS",
  "orages avec poussière": "DUTS",
  "temps partiellement nuageux avec poussiere": "DU",
  "temps partiellement nuageux avec poussière": "DU",
  "temps nuageux avec poussiere": "DU",
  "temps nuageux avec poussière": "DU",
  "temps ensoleille avec poussiere": "DU",
  "temps ensoleillé avec poussière": "DU",
  "poussiere": "DU",
  "poussière": "DU",
  "poussière en suspension": "DU",
  "ciel couvert avec poussière": "DU",
  "ciel nuageux avec poussière": "DU",
  "vent sable": "DU",
  "vent_sable": "DU",
};

const ICON_CODES = new Set([
  "TSRA",
  "RA",
  "TS",
  "NSW",
  "DUTSRA",
  "DURA",
  "DUTS",
  "DU",
]);
const ICON_CODE_ALIASES: Record<string, string> = {
  DUFUTSRA: "DUTSRA",
  DUFURA: "DURA",
};
const ICON_CODE_LIST = Array.from(ICON_CODES).sort();

const toIconCode = (label?: string | null) => {
  const trimmed = (label ?? "").trim();
  if (!trimmed) return "";
  const upper = trimmed.toUpperCase();
  if (ICON_CODE_ALIASES[upper]) {
    return ICON_CODE_ALIASES[upper];
  }
  if (ICON_CODES.has(upper)) {
    return upper;
  }
  const normalized = normalizeIconKey(trimmed);
  return ICON_NAME_TO_CODE[normalized] ?? "UNK";
};

const toCsvIconCode = (label?: string | null) => {
  const trimmed = (label ?? "").trim();
  if (!trimmed) return "";
  const upper = trimmed.toUpperCase();
  if (ICON_CODE_ALIASES[upper]) {
    return ICON_CODE_ALIASES[upper];
  }
  return ICON_CODES.has(upper) ? upper : "UNK";
};

const extractDateFromPayload = (payload: JsonMetricsFilePayload["data"]) => {
  const raw = payload?.date_bulletin ?? "";
  const match = raw.match(/Bulletin_du_(\d{2})_([A-Za-zÀ-ÿ]+)_(\d{4})/);
  if (!match) return null;
  const [, day, monthName, year] = match;
  const month = monthName
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
  const months: Record<string, string> = {
    janvier: "01",
    fevrier: "02",
    mars: "03",
    avril: "04",
    mai: "05",
    juin: "06",
    juillet: "07",
    aout: "08",
    septembre: "09",
    octobre: "10",
    novembre: "11",
    decembre: "12",
  };
  const monthValue = months[month];
  if (!monthValue) return null;
  return `${year}-${monthValue}-${day}`;
};

const parseCsvLine = (line: string, delimiter: string) => {
  const values: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === "\"") {
      if (inQuotes && line[i + 1] === "\"") {
        current += "\"";
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (char === delimiter && !inQuotes) {
      values.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  values.push(current);
  return values.map((value) => value.trim());
};

const parseCsvContent = (content: string): CsvRow[] => {
  const lines = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (lines.length === 0) return [];
  const delimiter = lines[0].includes(";") ? ";" : ",";
  const headers = parseCsvLine(lines[0], delimiter).map((h) => h.toLowerCase());
  return lines.slice(1).map((line) => {
    const values = parseCsvLine(line, delimiter);
    const row: CsvRow = {};
    headers.forEach((header, idx) => {
      row[header] = values[idx] ?? "";
    });
    return row;
  });
};

const toNumber = (value: string) => {
  const normalized = value.replace(",", ".").trim();
  if (!normalized) return null;
  const parsed = Number(normalized);
  return Number.isNaN(parsed) ? null : parsed;
};

const parseMonthToken = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed) return "";
  const numeric = Number(trimmed);
  if (!Number.isNaN(numeric) && numeric >= 1 && numeric <= 12) {
    return String(Math.trunc(numeric)).padStart(2, "0");
  }
  const normalized = trimmed
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
  const monthMap: Record<string, string> = {
    janvier: "01",
    fevrier: "02",
    mars: "03",
    avril: "04",
    mai: "05",
    juin: "06",
    juillet: "07",
    aout: "08",
    septembre: "09",
    octobre: "10",
    novembre: "11",
    decembre: "12",
  };
  return monthMap[normalized] ?? "";
};

const csvRowsToEntries = (rows: CsvRow[], source: string): JsonEntry[] => {
  const grouped = new Map<string, JsonEntry>();
  rows.forEach((row) => {
    const year = row.annee || row.year || "";
    const monthToken = row.mois || row.month || "";
    const month = parseMonthToken(monthToken);
    const day = row.jour || row.day || "";
    const date =
      row.date ||
      row.bulletin_date ||
      row.date_bulletin ||
      (year && month && day
        ? `${year}-${month}-${String(day).padStart(2, "0")}`
        : "");
    const station =
      row.localites ||
      row.station ||
      row.nom ||
      row.name ||
      row.station_name ||
      row.stationnom ||
      "";

    const hasForecast = Boolean(row.previsions || row.tmin_prev || row.tmax_prev);
    const hasObserved = Boolean(row.observations || row.tmin_obs || row.tmax_obs);

    if (date && station && (hasForecast || hasObserved)) {
      if (hasObserved) {
        const keyObs = `${date}::observed`;
        const entryObs =
          grouped.get(keyObs) ??
          ({
            date,
            mapType: "observed",
            stations: [],
            source,
          } as JsonEntry);
        entryObs.stations.push({
          nom: station,
          tmin: toNumber(row.tmin_obs || row.tmin || row.t_min || ""),
          tmax: toNumber(row.tmax_obs || row.tmax || row.t_max || ""),
          weather_icon: toCsvIconCode(
            row.observations || row.weather_obs || row.weather_icon || "",
          ),
        });
        grouped.set(keyObs, entryObs);
      }
      if (hasForecast) {
        const keyPrev = `${date}::forecast`;
        const entryPrev =
          grouped.get(keyPrev) ??
          ({
            date,
            mapType: "forecast",
            stations: [],
            source,
          } as JsonEntry);
        entryPrev.stations.push({
          nom: station,
          tmin: toNumber(row.tmin_prev || row.tmin_fore || ""),
          tmax: toNumber(row.tmax_prev || row.tmax_fore || ""),
          weather_icon: toCsvIconCode(
            row.previsions || row.weather_fore || row.weather_icon || "",
          ),
        });
        grouped.set(keyPrev, entryPrev);
      }
      return;
    }

    const mapTypeRaw =
      row.map_type || row.type || row.map || row.mode || row.maptype || "";
    if (!date || !mapTypeRaw || !station) return;
    const mapType = mapTypeRaw.toLowerCase().trim();
    const key = `${date}::${mapType}`;
    const entry =
      grouped.get(key) ??
      ({
        date,
        mapType,
        stations: [],
        source,
      } as JsonEntry);
    entry.stations.push({
      nom: station,
      tmin: toNumber(row.tmin || row.t_min || row.min || ""),
      tmax: toNumber(row.tmax || row.t_max || row.max || ""),
      weather_icon: toCsvIconCode(
        row.weather_icon || row.icon || row.picto || row.weather || "",
      ),
    });
    grouped.set(key, entry);
  });
  return Array.from(grouped.values());
};

const shiftDate = (dateStr: string, days: number) => {
  const [yearStr, monthStr, dayStr] = dateStr.split("-");
  const year = Number(yearStr);
  const month = Number(monthStr);
  const day = Number(dayStr);
  if (!year || !month || !day) return null;
  const base = new Date(Date.UTC(year, month - 1, day));
  base.setUTCDate(base.getUTCDate() + days);
  const yyyy = base.getUTCFullYear();
  const mm = String(base.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(base.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
};

const buildPairs = (entries: JsonEntry[], usePrevDay: boolean) => {
  const observedByDate = new Map<string, Map<string, JsonStation>>();
  const forecastByDate = new Map<string, Map<string, JsonStation>>();

  entries.forEach((entry) => {
    const dateKey = entry.date;
    if (!dateKey) return;
    const stationsMap = new Map<string, JsonStation>();
    entry.stations.forEach((station) => {
      const key = normalizeStation(station.nom);
      if (!key) return;
      stationsMap.set(key, station);
    });
    if (entry.mapType === "observed") {
      observedByDate.set(dateKey, stationsMap);
    } else if (entry.mapType === "forecast") {
      forecastByDate.set(dateKey, stationsMap);
    }
  });

  const pairs: StationPair[] = [];
  const skippedDates: Array<{ date: string; reason: string }> = [];
  observedByDate.forEach((observedStations, obsDate) => {
    const forecastDate = usePrevDay ? shiftDate(obsDate, -1) : obsDate;
    if (!forecastDate) {
      skippedDates.push({ date: obsDate, reason: "Date invalide" });
      return;
    }
    const forecastStations = forecastByDate.get(forecastDate);
    if (!forecastStations) {
      skippedDates.push({
        date: obsDate,
        reason: usePrevDay
          ? `Prévision manquante (J-1: ${forecastDate})`
          : "Prévision manquante (même jour)",
      });
      return;
    }
    observedStations.forEach((obs, station) => {
      const fore = forecastStations.get(station);
      if (!fore) return;
      pairs.push({
        date: obsDate,
        station,
        tminObs: typeof obs.tmin === "number" ? obs.tmin : null,
        tmaxObs: typeof obs.tmax === "number" ? obs.tmax : null,
        tminFore: typeof fore.tmin === "number" ? fore.tmin : null,
        tmaxFore: typeof fore.tmax === "number" ? fore.tmax : null,
        weatherObs: obs.weather_icon ?? null,
        weatherFore: fore.weather_icon ?? null,
      });
    });
  });

  return { pairs, skippedDates };
};

const computeTemperatureMetrics = (pairs: StationPair[]): TemperatureMetrics => {
  const tminPairs = pairs.filter((p) => p.tminObs !== null && p.tminFore !== null);
  const tmaxPairs = pairs.filter((p) => p.tmaxObs !== null && p.tmaxFore !== null);

  const mae = (values: number[]) => values.reduce((sum, val) => sum + val, 0) / values.length;
  const rmse = (values: number[]) =>
    Math.sqrt(values.reduce((sum, val) => sum + val * val, 0) / values.length);

  const metrics: TemperatureMetrics = {};

  if (tminPairs.length) {
    const errors = tminPairs.map((p) => (p.tminFore ?? 0) - (p.tminObs ?? 0));
    metrics.mae_tmin = mae(errors.map((e) => Math.abs(e)));
    metrics.rmse_tmin = rmse(errors);
    metrics.bias_tmin = mae(errors);
  }

  if (tmaxPairs.length) {
    const errors = tmaxPairs.map((p) => (p.tmaxFore ?? 0) - (p.tmaxObs ?? 0));
    metrics.mae_tmax = mae(errors.map((e) => Math.abs(e)));
    metrics.rmse_tmax = rmse(errors);
    metrics.bias_tmax = mae(errors);
  }

  metrics.temperature_sample_size = Math.min(
    tminPairs.length || tmaxPairs.length,
    tmaxPairs.length || tminPairs.length,
  );

  return metrics;
};

const computeWeatherMetrics = (pairs: StationPair[]): WeatherMetrics => {
  const filtered = pairs.filter((p) => p.weatherObs && p.weatherFore);
  if (!filtered.length) return {};

  const yTrueRaw = filtered.map((p) => toIconCode(p.weatherObs));
  const yPredRaw = filtered.map((p) => toIconCode(p.weatherFore));
  const validIndices = yTrueRaw
    .map((value, idx) => (value !== "UNK" && yPredRaw[idx] !== "UNK" ? idx : -1))
    .filter((idx) => idx >= 0);
  const yTrue = validIndices.map((idx) => yTrueRaw[idx]);
  const yPred = validIndices.map((idx) => yPredRaw[idx]);
  const hasUnknown = yTrueRaw.includes("UNK") || yPredRaw.includes("UNK");
  const labels = hasUnknown ? [...ICON_CODE_LIST, "UNK"] : [...ICON_CODE_LIST];
  const labelIndex = new Map(labels.map((label, idx) => [label, idx]));
  const matrix = Array.from({ length: labels.length }, () =>
    Array.from({ length: labels.length }, () => 0),
  );

  yTrue.forEach((label, idx) => {
    const row = labelIndex.get(label);
    const col = labelIndex.get(yPred[idx]);
    if (row === undefined || col === undefined) return;
    matrix[row][col] += 1;
  });

  const total = yTrue.length;
  let correct = 0;
  labels.forEach((_, idx) => {
    correct += matrix[idx][idx];
  });

  const support = labels.map(
    (label) => yTrue.filter((value) => value === label).length,
  );

  const precisionPerLabel = labels.map((_, idx) => {
    const colSum = matrix.reduce((sum, row) => sum + row[idx], 0);
    const tp = matrix[idx][idx];
    return colSum ? tp / colSum : 0;
  });

  const recallPerLabel = labels.map((_, idx) => {
    const rowSum = matrix[idx].reduce((sum, val) => sum + val, 0);
    const tp = matrix[idx][idx];
    return rowSum ? tp / rowSum : 0;
  });

  const f1PerLabel = precisionPerLabel.map((prec, idx) => {
    const rec = recallPerLabel[idx];
    return prec + rec === 0 ? 0 : (2 * prec * rec) / (prec + rec);
  });

  const weighted = (values: number[]) =>
    values.reduce((sum, value, idx) => sum + value * support[idx], 0) / total;

  return {
    accuracy_weather: correct / total,
    precision_weather: weighted(precisionPerLabel),
    recall_weather: weighted(recallPerLabel),
    f1_score_weather: weighted(f1PerLabel),
    weather_sample_size: total,
    confusion_matrix: {
      labels,
      matrix,
    },
  };
};

const computeMetrics = (pairs: StationPair[]): MetricsResult => {
  return {
    ...computeTemperatureMetrics(pairs),
    ...computeWeatherMetrics(pairs),
  };
};

type ContingencyScoreRow = {
  code: string;
  pod: number | null;
  far: number | null;
};

const computeContingencyScores = (pairs: StationPair[]) => {
  const filtered = pairs.filter((p) => p.weatherObs && p.weatherFore);
  if (!filtered.length) {
    return { pc: null as number | null, rows: [] as ContingencyScoreRow[] };
  }
  const yTrueRaw = filtered.map((p) => toIconCode(p.weatherObs));
  const yPredRaw = filtered.map((p) => toIconCode(p.weatherFore));
  const validIndices = yTrueRaw
    .map((value, idx) => (value !== "UNK" && yPredRaw[idx] !== "UNK" ? idx : -1))
    .filter((idx) => idx >= 0);
  const yTrue = validIndices.map((idx) => yTrueRaw[idx]);
  const yPred = validIndices.map((idx) => yPredRaw[idx]);
  if (!yTrue.length) {
    return { pc: null as number | null, rows: [] as ContingencyScoreRow[] };
  }

  const labels = [...ICON_CODE_LIST];
  const labelIndex = new Map(labels.map((label, idx) => [label, idx]));
  const matrix = Array.from({ length: labels.length }, () =>
    Array.from({ length: labels.length }, () => 0),
  );

  yTrue.forEach((label, idx) => {
    const row = labelIndex.get(label);
    const col = labelIndex.get(yPred[idx]);
    if (row === undefined || col === undefined) return;
    matrix[row][col] += 1;
  });

  const total = matrix.reduce(
    (sum, row) => sum + row.reduce((rowSum, value) => rowSum + value, 0),
    0,
  );
  const diag = labels.reduce((sum, _, i) => sum + (matrix[i]?.[i] ?? 0), 0);
  const pc = total > 0 ? (diag / total) * 100 : null;

  const rows = labels.map((label, idx) => {
    const oi = matrix[idx].reduce((sum, value) => sum + value, 0);
    const pi = matrix.reduce((sum, row) => sum + (row[idx] ?? 0), 0);
    const nii = matrix[idx]?.[idx] ?? 0;
    const pod = oi > 0 ? nii / oi : null;
    const rel = pi > 0 ? nii / pi : null;
    const far = rel !== null ? 1 - rel : null;
    return { code: label, pod, far };
  });

  return { pc, rows };
};

export function JsonMetricsPage() {
  const [files, setFiles] = useState<JsonMetricsFileInfo[]>([]);
  const [selectedPaths, setSelectedPaths] = useState<string[]>([]);
  const [fileFilter, setFileFilter] = useState("");
  const [loadingFiles, setLoadingFiles] = useState(false);
  const [loadingData, setLoadingData] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [jsonEntries, setJsonEntries] = useState<JsonEntry[]>([]);
  const [csvEntries, setCsvEntries] = useState<JsonEntry[]>([]);
  const [dataSource, setDataSource] = useState<"json" | "csv">("json");
  const [metricsMode, setMetricsMode] = useState<MetricsMode>("station");
  const [selectedStation, setSelectedStation] = useState<string>("");
  const [selectedMonth, setSelectedMonth] = useState<string>("");
  const [selectedYear, setSelectedYear] = useState<string>("");
  const [showSkippedDates, setShowSkippedDates] = useState<boolean>(false);
  const [csvArranged, setCsvArranged] = useState<boolean>(false);
  const [csvReadyEntries, setCsvReadyEntries] = useState<JsonEntry[]>([]);
  const [exporting, setExporting] = useState<boolean>(false);
  const tablesRef = useRef<HTMLDivElement | null>(null);
  const temperatureRef = useRef<HTMLDivElement | null>(null);
  const contingencyRef = useRef<HTMLDivElement | null>(null);
  const scoresRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const loadFiles = async () => {
      try {
        setLoadingFiles(true);
        const payload = await fetchJsonMetricsFiles();
        setFiles(payload.files ?? []);
        setError(null);
      } catch (err) {
        console.error("Echec du chargement des fichiers JSON:", err);
        setError("Echec du chargement des fichiers JSON.");
      } finally {
        setLoadingFiles(false);
      }
    };
    loadFiles();
  }, []);

  const filteredFiles = useMemo(() => {
    const term = fileFilter.trim().toLowerCase();
    if (!term) return files;
    return files.filter((file) =>
      [file.name, file.path, file.date, file.map_type]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(term)),
    );
  }, [files, fileFilter]);

  const allSelected =
    filteredFiles.length > 0 &&
    filteredFiles.every((file) => selectedPaths.includes(file.path));

  const handleToggleAll = () => {
    if (allSelected) {
      const remaining = selectedPaths.filter(
        (path) => !filteredFiles.find((file) => file.path === path),
      );
      setSelectedPaths(remaining);
    } else {
      const merged = new Set(selectedPaths);
      filteredFiles.forEach((file) => merged.add(file.path));
      setSelectedPaths(Array.from(merged));
    }
  };

  const handleToggleFile = (path: string) => {
    setSelectedPaths((prev) =>
      prev.includes(path) ? prev.filter((item) => item !== path) : [...prev, path],
    );
  };

  const handleLoadData = async () => {
    if (!selectedPaths.length) {
      setError("Sélectionnez au moins un fichier JSON.");
      return;
    }
    try {
      setLoadingData(true);
      const payloads = await Promise.all(
        selectedPaths.map((path) => fetchJsonMetricsFile(path)),
      );
      const normalized: JsonEntry[] = payloads
        .map((payload) => {
          const data = payload.data ?? {};
          const date = payload.data?.date_bulletin
            ? extractDateFromPayload(payload.data)
            : null;
          const fallbackDate = files.find((file) => file.path === payload.path)?.date ?? null;
          const normalizedDate = date ?? fallbackDate;
          return {
            date: normalizedDate ?? "",
            mapType: (data.map_type ?? "").toLowerCase(),
            stations: Array.isArray(data.stations) ? data.stations : [],
            source: payload.path,
          };
        })
        .filter((entry) => entry.date && entry.mapType);
      setJsonEntries(normalized);
      setError(null);
    } catch (err) {
      console.error("Echec du chargement des données JSON:", err);
      setError("Echec du chargement des données JSON.");
      setJsonEntries([]);
    } finally {
      setLoadingData(false);
    }
  };

  const processJsonFiles = async (filesList: FileList | File[]) => {
    if (!filesList || filesList.length === 0) return;
    const readers = Array.from(filesList).map(
      (file) =>
        new Promise<JsonMetricsFilePayload>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => {
            try {
              const payload = JSON.parse(String(reader.result ?? "{}"));
              resolve({ path: `local:${file.name}`, data: payload });
            } catch (err) {
              reject(err);
            }
          };
          reader.onerror = () => reject(reader.error);
          reader.readAsText(file);
        }),
    );

    try {
      setLoadingData(true);
      const payloads = await Promise.all(readers);
      const normalized: JsonEntry[] = payloads
        .map((payload) => {
          const data = payload.data ?? {};
          const date = extractDateFromPayload(data);
          return {
            date: date ?? "",
            mapType: (data.map_type ?? "").toLowerCase(),
            stations: Array.isArray(data.stations) ? data.stations : [],
            source: payload.path,
          };
        })
        .filter((entry) => entry.date && entry.mapType);
      setJsonEntries((prev) => [...prev, ...normalized]);
      setError(null);
    } catch (err) {
      console.error("Echec du chargement local:", err);
      setError("Impossible de lire certains fichiers JSON locaux.");
    } finally {
      setLoadingData(false);
    }
  };

  const handleLocalUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    await processJsonFiles(event.target.files ?? []);
    event.target.value = "";
  };

  const processCsvFiles = async (filesList: FileList | File[]) => {
    if (!filesList || filesList.length === 0) return;
    try {
      setLoadingData(true);
      const parsedEntries: JsonEntry[] = [];
      for (const file of Array.from(filesList)) {
        const content = await file.text();
        const rows = parseCsvContent(content);
        const entriesFromCsv = csvRowsToEntries(rows, `local:${file.name}`);
        parsedEntries.push(...entriesFromCsv);
      }
      if (parsedEntries.length === 0) {
        setError("Aucune donnée exploitable trouvée dans le CSV.");
      } else {
        setCsvEntries((prev) => [...prev, ...parsedEntries]);
        setSelectedStation("");
        setSelectedMonth("");
        setSelectedYear("");
        setError(null);
      }
    } catch (err) {
      console.error("Echec du chargement CSV:", err);
      setError("Impossible de lire certains fichiers CSV.");
    } finally {
      setLoadingData(false);
    }
  };

  const handleCsvUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    await processCsvFiles(event.target.files ?? []);
    event.target.value = "";
  };

  const handleApplyCsv = () => {
    setCsvReadyEntries(csvEntries);
  };

  const exportTables = async (format: "png" | "pdf", target: HTMLElement | null, name: string) => {
    if (!target) return;
    try {
      setExporting(true);
      const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
        import("html2canvas"),
        import("jspdf"),
      ]);
      const canvas = await html2canvas(target, {
        backgroundColor: "#ffffff",
        scale: 2,
      });
      const dataUrl = canvas.toDataURL("image/png");
      if (format === "png") {
        const link = document.createElement("a");
        link.href = dataUrl;
        link.download = `${name}.png`;
        link.click();
        return;
      }
      const pdf = new jsPDF({
        orientation: canvas.width > canvas.height ? "l" : "p",
        unit: "pt",
        format: [canvas.width, canvas.height],
      });
      pdf.addImage(dataUrl, "PNG", 0, 0, canvas.width, canvas.height);
      pdf.save(`${name}.pdf`);
    } catch (err) {
      console.error("Echec export tables:", err);
      setError("Impossible d'exporter les tableaux.");
    } finally {
      setExporting(false);
    }
  };

  const entries = dataSource === "json" ? jsonEntries : csvReadyEntries;
  const usePrevDay = dataSource === "json" || !csvArranged;
  const { pairs, skippedDates } = useMemo(
    () => buildPairs(entries, usePrevDay),
    [entries, usePrevDay],
  );

  const stationOptions = useMemo(() => {
    const set = new Set<string>();
    pairs.forEach((pair) => set.add(pair.station));
    return Array.from(set).sort();
  }, [pairs]);

  const monthOptions = useMemo(() => {
    const set = new Set<string>();
    pairs.forEach((pair) => set.add(pair.date.slice(0, 7)));
    return Array.from(set).sort();
  }, [pairs]);

  const yearOptions = useMemo(() => {
    const set = new Set<string>();
    pairs.forEach((pair) => set.add(pair.date.slice(0, 4)));
    return Array.from(set).sort();
  }, [pairs]);

  useEffect(() => {
    if (!selectedStation && stationOptions.length) {
      setSelectedStation(stationOptions[0]);
    }
  }, [selectedStation, stationOptions]);

  useEffect(() => {
    if (!selectedMonth && monthOptions.length) {
      setSelectedMonth(monthOptions[monthOptions.length - 1]);
    }
  }, [selectedMonth, monthOptions]);

  useEffect(() => {
    if (!selectedYear && yearOptions.length) {
      setSelectedYear(yearOptions[yearOptions.length - 1]);
    }
  }, [selectedYear, yearOptions]);

  useEffect(() => {
    setSelectedStation("");
    setSelectedMonth("");
    setSelectedYear("");
    setShowSkippedDates(false);
    setCsvArranged(false);
    setCsvReadyEntries([]);
  }, [dataSource]);

  const filteredPairs = useMemo(() => {
    if (metricsMode === "station") {
      const stationKey = normalizeStation(selectedStation);
      return pairs.filter((pair) => pair.station === stationKey);
    }
    if (metricsMode === "month" && selectedMonth) {
      return pairs.filter((pair) => pair.date.startsWith(selectedMonth));
    }
    if (metricsMode === "year" && selectedYear) {
      return pairs.filter((pair) => pair.date.startsWith(selectedYear));
    }
    return pairs;
  }, [metricsMode, pairs, selectedStation, selectedMonth, selectedYear]);

  const metrics = useMemo(() => computeMetrics(filteredPairs), [filteredPairs]);
  const hasTemperatureMetrics = (metrics.temperature_sample_size ?? 0) > 0;
  const hasWeatherMetrics = (metrics.weather_sample_size ?? 0) > 0;
  const confusion = metrics.confusion_matrix;
  const maxConfusionValue = useMemo(() => {
    if (!confusion?.matrix) return 0;
    return confusion.matrix.reduce((max, row) => Math.max(max, ...row), 0);
  }, [confusion]);
  const contingencyScores = useMemo(
    () => computeContingencyScores(filteredPairs),
    [filteredPairs],
  );
  const stationScoreMatrix = useMemo(() => {
    const stationList = Array.from(
      new Set(filteredPairs.map((pair) => pair.station).filter(Boolean)),
    ).sort();
    const scoresByStation = stationList.map((station) => {
      const stationPairs = filteredPairs.filter((pair) => pair.station === station);
      return { station, scores: computeContingencyScores(stationPairs) };
    });
    return { stationList, scoresByStation };
  }, [filteredPairs]);

  return (
    <Layout title="Calcul des métriques JSON">
      <div className="space-y-6">
        {error && <ErrorPanel message={error} />}
        <div className="grid gap-6 lg:grid-cols-[1.1fr,1fr]">
          <div className="surface-panel p-6">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold text-ink">Sources de données</h2>
                <p className="text-sm text-muted">
                  Séparez l'import JSON et CSV pour éviter les mélanges.
                </p>
              </div>
            </div>

            <div className="mt-4 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => setDataSource("json")}
                className={`rounded-xl border px-4 py-2 text-sm font-semibold transition ${
                  dataSource === "json"
                    ? "border-primary-500 bg-primary-50 text-primary-700"
                    : "border-[var(--border)] text-ink hover:bg-[var(--canvas-strong)]"
                }`}
              >
                Utiliser JSON
              </button>
              <button
                type="button"
                onClick={() => setDataSource("csv")}
                className={`rounded-xl border px-4 py-2 text-sm font-semibold transition ${
                  dataSource === "csv"
                    ? "border-primary-500 bg-primary-50 text-primary-700"
                    : "border-[var(--border)] text-ink hover:bg-[var(--canvas-strong)]"
                }`}
              >
                Utiliser CSV
              </button>
            </div>

            {dataSource === "json" && (
              <>
                <div className="mt-4 flex items-center justify-between text-xs text-muted font-mono">
                  <span>
                    {selectedPaths.length} / {files.length} sélectionnés
                  </span>
                  <span>JSON importés: {jsonEntries.length}</span>
                </div>

                {loadingFiles ? (
                  <div className="mt-4">
                    <LoadingPanel message="Chargement des fichiers JSON..." />
                  </div>
                ) : (
                  <>
                    <div className="mt-4 flex flex-wrap gap-3">
                      <input
                        type="text"
                        value={fileFilter}
                        onChange={(event) => setFileFilter(event.target.value)}
                        placeholder="Rechercher par date, nom, type..."
                        className="flex-1 min-w-[220px] rounded-xl border border-[var(--border)] bg-[var(--canvas-strong)] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400/40"
                      />
                      <button
                        type="button"
                        onClick={handleToggleAll}
                        className="rounded-xl border border-[var(--border)] px-4 py-2 text-sm font-semibold text-ink hover:bg-[var(--canvas-strong)]"
                      >
                        {allSelected ? "Tout désélectionner" : "Tout sélectionner"}
                      </button>
                    </div>

                    <div className="mt-4 max-h-[320px] overflow-y-auto rounded-2xl border border-[var(--border)]">
                      {filteredFiles.length === 0 ? (
                        <div className="p-4 text-sm text-muted">
                          Aucun fichier ne correspond au filtre.
                        </div>
                      ) : (
                        <ul className="divide-y divide-[var(--border)]">
                          {filteredFiles.map((file) => {
                            const checked = selectedPaths.includes(file.path);
                            return (
                              <li key={file.path} className="flex items-center gap-3 px-4 py-3">
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onChange={() => handleToggleFile(file.path)}
                                  className="size-4 accent-primary-500"
                                />
                                <div className="flex-1">
                                  <p className="text-sm font-medium text-ink">{file.name}</p>
                                  <p className="text-xs text-muted">
                                    {file.date ?? "Date inconnue"} · {file.map_type ?? "type inconnu"} ·{" "}
                                    {file.path}
                                  </p>
                                </div>
                                <span className="text-xs text-muted font-mono">
                                  {(file.size_bytes / 1024).toFixed(1)} KB
                                </span>
                              </li>
                            );
                          })}
                        </ul>
                      )}
                    </div>

                    <div className="mt-4 flex flex-wrap items-center gap-3">
                      <button
                        type="button"
                        onClick={handleLoadData}
                        disabled={loadingData}
                        className="inline-flex items-center gap-2 rounded-xl bg-primary-600 px-4 py-2 text-sm font-semibold text-white shadow-lg hover:bg-primary-700 disabled:opacity-60"
                      >
                        <span className="material-symbols-outlined text-base text-white">
                          play_circle
                        </span>
                        {loadingData ? "Chargement..." : "Charger et calculer"}
                      </button>
                      <label className="inline-flex items-center gap-2 rounded-xl border border-[var(--border)] px-4 py-2 text-sm font-semibold text-ink hover:bg-[var(--canvas-strong)] cursor-pointer">
                        <span className="material-symbols-outlined text-base">upload_file</span>
                        Charger JSON local
                        <input
                          type="file"
                          accept="application/json"
                          multiple
                          onChange={handleLocalUpload}
                          className="hidden"
                        />
                      </label>
                      <label className="inline-flex items-center gap-2 rounded-xl border border-[var(--border)] px-4 py-2 text-sm font-semibold text-ink hover:bg-[var(--canvas-strong)] cursor-pointer">
                        <span className="material-symbols-outlined text-base">folder_open</span>
                        Importer dossier JSON
                        <input
                          type="file"
                          multiple
                          // @ts-ignore - webkitdirectory is supported by Chromium
                          webkitdirectory="true"
                          onChange={(event) => {
                            processJsonFiles(event.target.files ?? []);
                            event.target.value = "";
                          }}
                          className="hidden"
                        />
                      </label>
                    </div>
                  </>
                )}
              </>
            )}

            {dataSource === "csv" && (
              <div className="mt-4 space-y-3">
                <div className="text-xs text-muted font-mono">
                  CSV importés: {csvEntries.length} · Utilisés: {csvReadyEntries.length}
                </div>
                <label className="flex items-center gap-2 text-xs text-muted">
                  <input
                    type="checkbox"
                    checked={csvArranged}
                    onChange={(event) => setCsvArranged(event.target.checked)}
                    className="size-4 accent-primary-500"
                  />
                  CSV arrangé (données vérifiées) — utiliser chaque ligne sans J-1
                </label>
                <div className="rounded-2xl border border-[var(--border)] bg-[var(--canvas-strong)] p-4 text-sm text-muted">
                  Colonnes attendues: ANNEE, MOIS, JOUR, LOCALITES, PREVISIONS, OBSERVATIONS,
                  TMIN_PREV, TMAX_PREV, TMIN_OBS, TMAX_OBS.
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <label className="inline-flex items-center gap-2 rounded-xl border border-[var(--border)] px-4 py-2 text-sm font-semibold text-ink hover:bg-[var(--canvas-strong)] cursor-pointer">
                    <span className="material-symbols-outlined text-base">table_view</span>
                    Charger CSV local
                    <input
                      type="file"
                      accept=".csv,text/csv"
                      multiple
                      onChange={handleCsvUpload}
                      className="hidden"
                    />
                  </label>
                  <label className="inline-flex items-center gap-2 rounded-xl border border-[var(--border)] px-4 py-2 text-sm font-semibold text-ink hover:bg-[var(--canvas-strong)] cursor-pointer">
                    <span className="material-symbols-outlined text-base">folder_open</span>
                    Importer dossier CSV
                    <input
                      type="file"
                      multiple
                      accept=".csv,text/csv"
                      // @ts-ignore - webkitdirectory is supported by Chromium
                      webkitdirectory="true"
                      onChange={(event) => {
                        processCsvFiles(event.target.files ?? []);
                        event.target.value = "";
                      }}
                      className="hidden"
                    />
                  </label>
                  <button
                    type="button"
                    onClick={handleApplyCsv}
                    disabled={csvEntries.length === 0}
                    className="inline-flex items-center gap-2 rounded-xl bg-primary-600 px-4 py-2 text-sm font-semibold text-white shadow-lg hover:bg-primary-700 disabled:opacity-60"
                  >
                    <span className="material-symbols-outlined text-base text-white">
                      play_circle
                    </span>
                    Lancer les calculs
                  </button>
                </div>
              </div>
            )}
          </div>

          <div className="surface-panel p-6">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold text-ink">Paramètres de calcul</h2>
                <p className="text-sm text-muted">Choisissez le niveau d'analyse.</p>
              </div>
              <span className="text-xs text-muted font-mono">{pairs.length} paires</span>
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              {(Object.keys(MODE_LABELS) as MetricsMode[]).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setMetricsMode(mode)}
                  className={`rounded-xl border px-4 py-2 text-sm font-semibold transition ${
                    metricsMode === mode
                      ? "border-primary-500 bg-primary-50 text-primary-700"
                      : "border-[var(--border)] text-ink hover:bg-[var(--canvas-strong)]"
                  }`}
                >
                  {MODE_LABELS[mode]}
                </button>
              ))}
            </div>

            <div className="mt-4 grid gap-4">
              {metricsMode === "station" && (
                <div>
                  <label className="block text-sm font-medium text-ink">Station</label>
                  <select
                    value={selectedStation}
                    onChange={(event) => setSelectedStation(event.target.value)}
                    className="mt-1 w-full rounded-xl border border-[var(--border)] bg-[var(--canvas-strong)] px-3 py-2 text-sm"
                  >
                    {stationOptions.length === 0 && <option value="">Aucune station</option>}
                    {stationOptions.map((station) => (
                      <option key={station} value={station}>
                        {station}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              {metricsMode === "month" && (
                <div>
                  <label className="block text-sm font-medium text-ink">Mois</label>
                  <select
                    value={selectedMonth}
                    onChange={(event) => setSelectedMonth(event.target.value)}
                    className="mt-1 w-full rounded-xl border border-[var(--border)] bg-[var(--canvas-strong)] px-3 py-2 text-sm"
                  >
                    {monthOptions.length === 0 && <option value="">Aucun mois</option>}
                    {monthOptions.map((month) => (
                      <option key={month} value={month}>
                        {month}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              {metricsMode === "year" && (
                <div>
                  <label className="block text-sm font-medium text-ink">Année</label>
                  <select
                    value={selectedYear}
                    onChange={(event) => setSelectedYear(event.target.value)}
                    className="mt-1 w-full rounded-xl border border-[var(--border)] bg-[var(--canvas-strong)] px-3 py-2 text-sm"
                  >
                    {yearOptions.length === 0 && <option value="">Aucune année</option>}
                    {yearOptions.map((year) => (
                      <option key={year} value={year}>
                        {year}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>

            <div className="mt-6 rounded-2xl border border-dashed border-[var(--border)] bg-[var(--canvas-strong)] p-4">
              <p className="text-sm text-muted">Paires utilisées: {filteredPairs.length}</p>
              <div className="mt-3 flex items-center gap-2 text-xs">
                <input
                  id="toggle-skipped-dates"
                  type="checkbox"
                  checked={showSkippedDates}
                  onChange={(event) => setShowSkippedDates(event.target.checked)}
                  className="size-4 accent-primary-500"
                />
                <label htmlFor="toggle-skipped-dates" className="text-muted">
                  Afficher les dates ignorées ({skippedDates.length})
                </label>
              </div>
              <div className="mt-3 flex flex-wrap gap-2 text-xs">
                <span className="rounded-full bg-primary-50 px-3 py-1 text-primary-700">
                  Mode: {MODE_LABELS[metricsMode]}
                </span>
                {metricsMode === "station" && selectedStation && (
                  <span className="rounded-full bg-[var(--surface)] px-3 py-1 text-ink">
                    Station: {selectedStation}
                  </span>
                )}
                {metricsMode === "month" && selectedMonth && (
                  <span className="rounded-full bg-[var(--surface)] px-3 py-1 text-ink">
                    Mois: {selectedMonth}
                  </span>
                )}
                {metricsMode === "year" && selectedYear && (
                  <span className="rounded-full bg-[var(--surface)] px-3 py-1 text-ink">
                    Année: {selectedYear}
                  </span>
                )}
              </div>
              <p className="mt-2 text-xs text-muted">
                Dernière mise à jour: {entries.length ? new Date().toLocaleString() : "--"}
              </p>
            </div>
            {showSkippedDates && skippedDates.length > 0 && (
              <div className="mt-4 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
                <h4 className="text-sm font-semibold text-ink">Dates ignorées</h4>
                <ul className="mt-2 max-h-44 overflow-y-auto text-xs text-muted">
                  {skippedDates.map((item) => (
                    <li key={`${item.date}-${item.reason}`} className="py-1">
                      {item.date} — {item.reason}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>

        {loadingData && <LoadingPanel message="Calcul des métriques..." />}

        {!loadingData && entries.length > 0 && (
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => exportTables("png", tablesRef.current, "tables-meteo")}
              disabled={exporting}
              className="inline-flex items-center gap-2 rounded-xl border border-[var(--border)] px-4 py-2 text-sm font-semibold text-ink hover:bg-[var(--canvas-strong)] disabled:opacity-60"
            >
              <span className="material-symbols-outlined text-base">image</span>
              Exporter PNG
            </button>
            <button
              type="button"
              onClick={() => exportTables("pdf", tablesRef.current, "tables-meteo")}
              disabled={exporting}
              className="inline-flex items-center gap-2 rounded-xl border border-[var(--border)] px-4 py-2 text-sm font-semibold text-ink hover:bg-[var(--canvas-strong)] disabled:opacity-60"
            >
              <span className="material-symbols-outlined text-base">picture_as_pdf</span>
              Exporter PDF
            </button>
          </div>
        )}

        <div ref={tablesRef} className="space-y-6">
          {!loadingData && entries.length > 0 && (hasTemperatureMetrics || hasWeatherMetrics) && (
            <div className="grid gap-6 lg:grid-cols-2">
            {hasTemperatureMetrics && (
              <div className="surface-panel p-6" ref={temperatureRef}>
                <div className="flex items-center justify-between">
                  <h3 className="text-lg font-semibold text-ink">Température</h3>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        exportTables("png", temperatureRef.current, "table-temperature")
                      }
                      disabled={exporting}
                      className="rounded-lg border border-[var(--border)] px-3 py-1 text-xs font-semibold text-ink hover:bg-[var(--canvas-strong)] disabled:opacity-60"
                    >
                      PNG
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        exportTables("pdf", temperatureRef.current, "table-temperature")
                      }
                      disabled={exporting}
                      className="rounded-lg border border-[var(--border)] px-3 py-1 text-xs font-semibold text-ink hover:bg-[var(--canvas-strong)] disabled:opacity-60"
                    >
                      PDF
                    </button>
                  </div>
                </div>
                <div className="mt-4 grid gap-4 sm:grid-cols-2">
                  <div className="rounded-2xl border border-[var(--border)] bg-[var(--canvas-strong)] p-4">
                    <p className="text-xs uppercase tracking-[0.3em] text-muted">MAE</p>
                    <p className="mt-2 text-sm text-muted">Tmin</p>
                    <p className="text-2xl font-semibold text-ink">
                      {formatNumber(metrics.mae_tmin)}°C
                    </p>
                    <p className="mt-2 text-sm text-muted">Tmax</p>
                    <p className="text-2xl font-semibold text-ink">
                      {formatNumber(metrics.mae_tmax)}°C
                    </p>
                  </div>
                  <div className="rounded-2xl border border-[var(--border)] bg-[var(--canvas-strong)] p-4">
                    <p className="text-xs uppercase tracking-[0.3em] text-muted">RMSE</p>
                    <p className="mt-2 text-sm text-muted">Tmin</p>
                    <p className="text-2xl font-semibold text-ink">
                      {formatNumber(metrics.rmse_tmin)}°C
                    </p>
                    <p className="mt-2 text-sm text-muted">Tmax</p>
                    <p className="text-2xl font-semibold text-ink">
                      {formatNumber(metrics.rmse_tmax)}°C
                    </p>
                  </div>
                  <div className="rounded-2xl border border-[var(--border)] bg-[var(--canvas-strong)] p-4">
                    <p className="text-xs uppercase tracking-[0.3em] text-muted">Biais</p>
                    <p className="mt-2 text-sm text-muted">Tmin</p>
                    <p className="text-2xl font-semibold text-ink">
                      {formatNumber(metrics.bias_tmin)}°C
                    </p>
                    <p className="mt-2 text-sm text-muted">Tmax</p>
                    <p className="text-2xl font-semibold text-ink">
                      {formatNumber(metrics.bias_tmax)}°C
                    </p>
                  </div>
                  <div className="rounded-2xl border border-[var(--border)] bg-[var(--canvas-strong)] p-4">
                    <p className="text-xs uppercase tracking-[0.3em] text-muted">Echantillon</p>
                    <p className="mt-4 text-3xl font-semibold text-ink">
                      {metrics.temperature_sample_size ?? "--"}
                    </p>
                    <p className="text-sm text-muted">Stations comparées</p>
                  </div>
                </div>
              </div>
            )}

            {hasWeatherMetrics && (
              <div className="surface-panel p-6">
                <h3 className="text-lg font-semibold text-ink">Conditions météo</h3>
                <div className="mt-4 grid gap-4 sm:grid-cols-2">
                  <div className="rounded-2xl border border-[var(--border)] bg-[var(--canvas-strong)] p-4">
                    <p className="text-xs uppercase tracking-[0.3em] text-muted">Exactitude</p>
                    <p className="mt-4 text-3xl font-semibold text-ink">
                      {formatNumber((metrics.accuracy_weather ?? 0) * 100, 1)}%
                    </p>
                    <p className="text-sm text-muted">
                      Précision {formatNumber(metrics.precision_weather, 2)}
                    </p>
                  </div>
                  <div className="rounded-2xl border border-[var(--border)] bg-[var(--canvas-strong)] p-4">
                    <p className="text-xs uppercase tracking-[0.3em] text-muted">Rappel / F1</p>
                    <p className="mt-4 text-3xl font-semibold text-ink">
                      {formatNumber((metrics.recall_weather ?? 0) * 100, 1)}%
                    </p>
                    <p className="text-sm text-muted">
                      F1 {formatNumber(metrics.f1_score_weather, 2)}
                    </p>
                  </div>
                  <div className="rounded-2xl border border-[var(--border)] bg-[var(--canvas-strong)] p-4 sm:col-span-2">
                    <p className="text-xs uppercase tracking-[0.3em] text-muted">Echantillon météo</p>
                    <p className="mt-4 text-3xl font-semibold text-ink">
                      {metrics.weather_sample_size ?? "--"}
                    </p>
                  </div>
                </div>
              </div>
            )}
          </div>
          )}

          {!loadingData && (
            <div className="surface-panel p-6" ref={contingencyRef}>
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-lg font-semibold text-ink">Table de contingence</h3>
                <p className="text-sm text-muted">
                  Icônes observées (lignes) vs icônes prévues (colonnes).
                </p>
              </div>
              <span className="text-xs text-muted font-mono">
                {confusion?.labels?.length ?? 0} classes
              </span>
            </div>
            <div className="mt-2 flex items-center gap-2">
              <button
                type="button"
                onClick={() => exportTables("png", contingencyRef.current, "table-contingence")}
                disabled={exporting}
                className="rounded-lg border border-[var(--border)] px-3 py-1 text-xs font-semibold text-ink hover:bg-[var(--canvas-strong)] disabled:opacity-60"
              >
                PNG
              </button>
              <button
                type="button"
                onClick={() => exportTables("pdf", contingencyRef.current, "table-contingence")}
                disabled={exporting}
                className="rounded-lg border border-[var(--border)] px-3 py-1 text-xs font-semibold text-ink hover:bg-[var(--canvas-strong)] disabled:opacity-60"
              >
                PDF
              </button>
            </div>
            <div className="mt-4 overflow-x-auto">
              {confusion?.labels && confusion.matrix ? (
                <table className="min-w-full text-xs">
                  <thead>
                  <tr className="text-left text-muted">
                    <th className="py-2 pr-2"></th>
                    {confusion.labels
                      .map((label, index) => ({ label, index }))
                      .filter((item) => item.label !== "UNK")
                      .map((item) => (
                      <th
                        key={`obs-${item.label}`}
                        className="py-2 px-2 text-center font-semibold"
                      >
                        Obs: {item.label}
                      </th>
                    ))}
                    <th className="py-2 px-2 text-center font-semibold">Total</th>
                  </tr>
                  </thead>
                  <tbody>
                  {confusion.labels
                    .map((rowLabel, rowIndex) => ({ rowLabel, rowIndex }))
                    .filter((item) => item.rowLabel !== "UNK")
                    .map(({ rowLabel, rowIndex }) => {
                    const rowTotal = confusion.labels
                      .map((colLabel, colIdx) => ({ colLabel, colIdx }))
                      .filter((item) => item.colLabel !== "UNK")
                      .reduce((sum, item) => {
                        const value = confusion.matrix[item.colIdx]?.[rowIndex] ?? 0;
                        return sum + value;
                      }, 0);
                    return (
                      <tr key={`row-${rowIndex}`} className="border-t border-[var(--border)]">
                        <td className="py-2 pr-2 font-semibold whitespace-nowrap text-ink">
                          Prév: {rowLabel}
                        </td>
                        {confusion.labels
                          .map((colLabel, colIndex) => ({ colLabel, colIndex }))
                          .filter((item) => item.colLabel !== "UNK")
                          .map((item) => {
                          const value = confusion.matrix[item.colIndex]?.[rowIndex] ?? 0;
                          const intensity = maxConfusionValue ? value / maxConfusionValue : 0;
                          return (
                            <td
                              key={`cell-${rowIndex}-${item.colIndex}`}
                              className="py-2 px-2 text-center font-mono"
                              style={{
                                backgroundColor: `rgba(59, 130, 246, ${intensity * 0.25})`,
                                color: intensity > 0.55 ? "white" : "inherit",
                              }}
                            >
                              {value}
                            </td>
                          );
                        })}
                        <td className="py-2 px-2 text-center font-mono font-semibold text-ink">
                          {rowTotal}
                        </td>
                      </tr>
                    );
                  })}
                  <tr className="border-t border-[var(--border)] bg-[var(--canvas-strong)]">
                    <td className="py-2 pr-2 font-semibold text-ink whitespace-nowrap">Total</td>
                    {confusion.labels
                      .map((label, colIndex) => ({ label, colIndex }))
                      .filter((item) => item.label !== "UNK")
                      .map((item) => {
                      const colTotal = confusion.labels
                        .map((rowLabel, rowIdx) => ({ rowLabel, rowIdx }))
                        .filter((row) => row.rowLabel !== "UNK")
                        .reduce((sum, row) => {
                          const value = confusion.matrix[item.colIndex]?.[row.rowIdx] ?? 0;
                          return sum + value;
                        }, 0);
                      return (
                        <td
                          key={`total-col-${item.colIndex}`}
                          className="py-2 px-2 text-center font-mono font-semibold text-ink"
                        >
                          {colTotal}
                        </td>
                      );
                    })}
                    <td className="py-2 px-2 text-center font-mono font-semibold text-ink">
                      {confusion.labels
                        .map((rowLabel, rowIdx) => ({ rowLabel, rowIdx }))
                        .filter((row) => row.rowLabel !== "UNK")
                        .reduce((sum, row) => {
                          const rowTotal = confusion.labels
                            .map((colLabel, colIdx) => ({ colLabel, colIdx }))
                            .filter((col) => col.colLabel !== "UNK")
                            .reduce((rowSum, col) => {
                              const value = confusion.matrix[col.colIdx]?.[row.rowIdx] ?? 0;
                              return rowSum + value;
                            }, 0);
                          return sum + rowTotal;
                        }, 0)}
                    </td>
                  </tr>
                  </tbody>
                </table>
              ) : (
                <div className="rounded-2xl border border-dashed border-[var(--border)] bg-[var(--canvas-strong)] p-6 text-center">
                  <span className="material-symbols-outlined text-3xl text-primary-300 mb-2">
                    grid_view
                  </span>
                  <p className="text-sm text-muted">
                    Aucune matrice de confusion disponible pour cette sélection.
                  </p>
                </div>
              )}
            </div>
            </div>
          )}

          {!loadingData && contingencyScores.rows.length > 0 && (
            <div className="surface-panel p-6" ref={scoresRef}>
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-lg font-semibold text-ink">Scores des prévisions</h3>
                <p className="text-sm text-muted">
                  Affichage type tableau (PC, POD, FAR) par station.
                </p>
              </div>
              <span className="text-xs text-muted font-mono">
                PC: {contingencyScores.pc !== null ? `${formatScore(contingencyScores.pc, 2)}%` : "ND"}
              </span>
            </div>
            <div className="mt-2 flex items-center gap-2">
              <button
                type="button"
                onClick={() => exportTables("png", scoresRef.current, "table-scores")}
                disabled={exporting}
                className="rounded-lg border border-[var(--border)] px-3 py-1 text-xs font-semibold text-ink hover:bg-[var(--canvas-strong)] disabled:opacity-60"
              >
                PNG
              </button>
              <button
                type="button"
                onClick={() => exportTables("pdf", scoresRef.current, "table-scores")}
                disabled={exporting}
                className="rounded-lg border border-[var(--border)] px-3 py-1 text-xs font-semibold text-ink hover:bg-[var(--canvas-strong)] disabled:opacity-60"
              >
                PDF
              </button>
            </div>
            <div className="mt-4 overflow-x-auto">
              <table className="min-w-full text-xs border border-[var(--border)]">
                <thead>
                  <tr className="text-left text-ink bg-[var(--canvas-strong)]">
                    <th className="py-2 pr-2 font-semibold">Scores</th>
                    <th className="py-2 px-2 text-center font-semibold">Global</th>
                    {stationScoreMatrix.stationList.map((station) => (
                      <th key={`station-${station}`} className="py-2 px-2 text-center font-semibold">
                        {station}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-t border-[var(--border)] bg-lime-200/60">
                    <td className="py-2 pr-2 font-semibold text-ink">PC</td>
                    <td className="py-2 px-2 text-center font-mono">
                      {contingencyScores.pc !== null ? formatScore(contingencyScores.pc, 2) : "ND"}
                    </td>
                    {stationScoreMatrix.scoresByStation.map((entry) => (
                      <td key={`pc-${entry.station}`} className="py-2 px-2 text-center font-mono">
                        {entry.scores.pc !== null ? formatScore(entry.scores.pc, 2) : "ND"}
                      </td>
                    ))}
                  </tr>
                  {contingencyScores.rows.map((row) => (
                    <tr key={`pod-${row.code}`} className="border-t border-[var(--border)] bg-yellow-200/70">
                      <td className="py-2 pr-2 font-semibold text-ink">POD({row.code})</td>
                      <td className="py-2 px-2 text-center font-mono">
                        {row.pod !== null ? formatScore(row.pod, 2) : "ND"}
                      </td>
                      {stationScoreMatrix.scoresByStation.map((entry) => {
                        const stationRow = entry.scores.rows.find(
                          (item) => item.code === row.code,
                        );
                        return (
                          <td
                            key={`pod-${entry.station}-${row.code}`}
                            className="py-2 px-2 text-center font-mono"
                          >
                            {stationRow?.pod !== null && stationRow?.pod !== undefined
                              ? formatScore(stationRow.pod, 2)
                              : "ND"}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                  {contingencyScores.rows.map((row) => (
                    <tr key={`far-${row.code}`} className="border-t border-[var(--border)] bg-rose-100/80">
                      <td className="py-2 pr-2 font-semibold text-ink">FAR({row.code})</td>
                      <td className="py-2 px-2 text-center font-mono">
                        {row.far !== null ? formatScore(row.far, 2) : "ND"}
                      </td>
                      {stationScoreMatrix.scoresByStation.map((entry) => {
                        const stationRow = entry.scores.rows.find(
                          (item) => item.code === row.code,
                        );
                        return (
                          <td
                            key={`far-${entry.station}-${row.code}`}
                            className="py-2 px-2 text-center font-mono"
                          >
                            {stationRow?.far !== null && stationRow?.far !== undefined
                              ? formatScore(stationRow.far, 2)
                              : "ND"}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            </div>
          )}
        </div>
      </div>
    </Layout>
  );
}
