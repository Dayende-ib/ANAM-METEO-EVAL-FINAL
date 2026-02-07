import { API_BASE_URL, API_CACHE_TTL_MS } from "../config";
import { finishRequest, reportError, startRequest } from "./statusStore";

const API_BASE = API_BASE_URL.replace(/\/+$/, "");
const CACHE_PREFIX = "api_cache:";
const AUTH_TOKEN_KEY = "anam_auth_token";

export function getAuthToken(): string | null {
  if (typeof window === "undefined") return null;
  const raw =
    window.localStorage.getItem(AUTH_TOKEN_KEY) ??
    window.sessionStorage.getItem(AUTH_TOKEN_KEY);
  return raw && raw.trim() ? raw : null;
}

export function setAuthToken(token: string | null, persist = true) {
  if (typeof window === "undefined") return;
  if (!token) {
    window.localStorage.removeItem(AUTH_TOKEN_KEY);
    window.sessionStorage.removeItem(AUTH_TOKEN_KEY);
    return;
  }
  if (persist) {
    window.localStorage.setItem(AUTH_TOKEN_KEY, token);
    window.sessionStorage.removeItem(AUTH_TOKEN_KEY);
  } else {
    window.sessionStorage.setItem(AUTH_TOKEN_KEY, token);
    window.localStorage.removeItem(AUTH_TOKEN_KEY);
  }
}

function attachAuthHeader(headers: Headers) {
  if (headers.has("Authorization")) {
    return;
  }
  const token = getAuthToken();
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }
}

function readCache<T>(key: string): T | null {
  if (API_CACHE_TTL_MS <= 0 || typeof window === "undefined") {
    return null;
  }
  const raw = window.localStorage.getItem(`${CACHE_PREFIX}${key}`);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { ts: number; value: T };
    if (Date.now() - parsed.ts > API_CACHE_TTL_MS) {
      window.localStorage.removeItem(`${CACHE_PREFIX}${key}`);
      return null;
    }
    return parsed.value;
  } catch {
    return null;
  }
}

function writeCache<T>(key: string, value: T) {
  if (API_CACHE_TTL_MS <= 0 || typeof window === "undefined") {
    return;
  }
  try {
    const payload = JSON.stringify({ ts: Date.now(), value });
    window.localStorage.setItem(`${CACHE_PREFIX}${key}`, payload);
  } catch {
    // ignore cache write errors
  }
}

export interface ApiErrorPayload {
  success: false;
  error: {
    code: string;
    message: string;
    status: number;
    traceId?: string;
    details?: unknown;
  };
}

export class ApiError extends Error {
  status?: number;
  code?: string;
  traceId?: string;
  details?: unknown;

  constructor(
    message: string,
    options: {
      status?: number;
      code?: string;
      traceId?: string;
      details?: unknown;
    } = {},
  ) {
    super(message);
    this.name = "ApiError";
    this.status = options.status;
    this.code = options.code;
    this.traceId = options.traceId;
    this.details = options.details;
  }
}

function createTraceId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function isApiErrorPayload(payload: unknown): payload is ApiErrorPayload {
  if (!payload || typeof payload !== "object") {
    return false;
  }
  const candidate = payload as { error?: unknown; success?: unknown };
  if (!candidate.error || candidate.success !== false) {
    return false;
  }
  const error = candidate.error as { code?: unknown; message?: unknown; status?: unknown };
  return typeof error.code === "string" && typeof error.message === "string";
}

function unwrapData<T>(payload: unknown): T | null {
  if (payload && typeof payload === "object") {
    const candidate = payload as { data?: unknown; success?: unknown };
    if (candidate.success === true && candidate.data !== undefined) {
      return candidate.data as T;
    }
  }
  return payload as T;
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const url = `${API_BASE}${path.startsWith("/") ? path : `/${path}`}`;
  const isGet = !init?.method || init.method === "GET";
  const cached = isGet ? readCache<T>(url) : null;
  const headers = new Headers(init?.headers ?? {});
  if (!headers.has("Accept")) {
    headers.set("Accept", "application/json");
  }
  if (!headers.has("X-Trace-Id")) {
    headers.set("X-Trace-Id", createTraceId());
  }
  attachAuthHeader(headers);
  startRequest();
  try {
    const response = await fetch(url, { ...init, headers });
    const text = await response.text();
    let payload: unknown = null;

    if (text) {
      try {
        payload = JSON.parse(text);
      } catch (error) {
        payload = null;
      }
    }

    if (!response.ok) {
      if (cached !== null) {
        reportError("API indisponible, affichage des donnees en cache.");
        return cached as T;
      }
      if (isApiErrorPayload(payload)) {
        const message = payload.error.message;
        reportError(message);
        throw new ApiError(message, {
          status: payload.error.status ?? response.status,
          code: payload.error.code,
          traceId: payload.error.traceId,
          details: payload.error.details,
        });
      }
      const message = text || `Request failed (${response.status})`;
      reportError(message);
      throw new ApiError(message, { status: response.status });
    }

    if (payload === null) {
      if (cached !== null) {
        reportError("API indisponible, affichage des donnees en cache.");
        return cached as T;
      }
      const message = `Invalid API response. Check that the backend is running and returns JSON at ${url}.`;
      reportError(message);
      throw new Error(message);
    }

    if (isGet) {
      writeCache(url, payload);
    }
    return unwrapData<T>(payload) as T;
  } catch (error) {
    if (cached !== null) {
      reportError("API indisponible, affichage des donnees en cache.");
      return cached as T;
    }
    if (error instanceof Error) {
      reportError(error.message);
    }
    throw error;
  } finally {
    finishRequest();
  }
}

async function requestJsonWithFallback<T>(path: string, init?: RequestInit): Promise<T> {
  try {
    return await requestJson<T>(path, init);
  } catch (error) {
    const altBase = API_BASE.endsWith("/api") ? `${API_BASE}/v1` : null;
    if (!altBase) {
      throw error;
    }
    const url = `${altBase}${path.startsWith("/") ? path : `/${path}`}`;
    const headers = new Headers(init?.headers ?? {});
    attachAuthHeader(headers);
    const response = await fetch(url, {
      ...init,
      headers,
    });
    const text = await response.text();
    let payload: unknown = null;
    if (text) {
      try {
        payload = JSON.parse(text);
      } catch {
        payload = null;
      }
    }
    if (!response.ok) {
      const message = text || `Request failed (${response.status})`;
      throw new ApiError(message, { status: response.status });
    }
    if (payload === null) {
      throw new Error(`Invalid API response at ${url}`);
    }
    return unwrapData<T>(payload) as T;
  }
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  return requestJson<T>(path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(body ?? {}),
  });
}

export interface BulletinSummary {
  date: string;
  type: "observation" | "forecast";
  pages: number;
  interpretation_francais?: string | null;
  interpretation_moore?: string | null;
  interpretation_dioula?: string | null;
}

export interface BulletinsResponse {
  bulletins: BulletinSummary[];
  total?: number;
  limit?: number;
  offset?: number;
}

export interface StationPayload {
  name?: string;
  latitude?: number;
  longitude?: number;
  tmin_obs?: number | null;
  tmax_obs?: number | null;
  weather_obs?: string | null;
  tmin_prev?: number | null;
  tmax_prev?: number | null;
  weather_prev?: string | null;
  interpretation_francais?: string | null;
  interpretation_moore?: string | null;
  interpretation_dioula?: string | null;
  quality_score?: number | null;
}

export interface BulletinDetail {
  date_bulletin: string;
  type?: "observation" | "forecast" | string;
  stations: StationPayload[];
  interpretation_francais?: string | null;
  interpretation_moore?: string | null;
  interpretation_dioula?: string | null;
}

export interface MetricsResponse {
  date: string;
  forecast_reference_date: string;
  mae_tmin?: number | null;
  mae_tmax?: number | null;
  rmse_tmin?: number | null;
  rmse_tmax?: number | null;
  bias_tmin?: number | null;
  bias_tmax?: number | null;
  accuracy_weather?: number | null;
  precision_weather?: number | null;
  recall_weather?: number | null;
  f1_score_weather?: number | null;
  confusion_matrix?: {
    labels: string[];
    matrix: number[][];
  } | null;
  sample_size?: number | null;
}

export interface MetricsListResponse {
  items: MetricsResponse[];
  total: number;
}

export type ManualMetricsStation = {
  nom?: string | null;
  tmin?: number | null;
  tmax?: number | null;
  weather_icon?: string | null;
};

export type ManualMetricsEntry = {
  date: string;
  mapType: string;
  source?: string | null;
  stations: ManualMetricsStation[];
};

export type ManualMetricsIngestRequest = {
  source?: string | null;
  entries: ManualMetricsEntry[];
};

export type ManualMetricsIngestResponse = {
  inserted_bulletins: number;
  updated_payloads: number;
  skipped: number;
};

export interface PipelineStepDto {
  key?: string;
  step?: string;
  label?: string;
  status?: string;
  started_at?: string;
  finished_at?: string;
  startTime?: string;
  endTime?: string;
  message?: string;
  meta?: Record<string, unknown>;
  errors?: string[];
  warnings?: string[];
}

export interface PipelineRunSummaryDto {
  id: number;
  status: string;
  started_at: string;
  finished_at?: string;
  start_time?: string;
  finish_time?: string;
  metadata?: Record<string, unknown>;
  error_message?: string | null;
  last_update?: string | null;
}

export interface PipelineRunDetailDto extends PipelineRunSummaryDto {
  steps: PipelineStepDto[];
}

export interface PipelineRunsResponse {
  runs: PipelineRunSummaryDto[];
  total?: number;
  limit?: number;
  offset?: number;
}

export interface PipelineTriggerRequest {
  use_scraping?: boolean;
  year?: number;
  month?: number;
  day?: number;
  max_bulletins?: number;
}

export interface PipelineTriggerResponse {
  run_id: number;
  status: string;
}

export interface ScrapeRequest {
  use_pagination?: boolean;
  year?: number;
  month?: number;
  day?: number;
  max_pages?: number;
  max_bulletins?: number;
  delay?: number;
  output_dir?: string;
  max_size_mb?: number;
  retries?: number;
  backoff?: number;
  connect_timeout?: number;
  read_timeout?: number;
  verify_ssl?: boolean;
}

export interface ScrapeResponse {
  total: number;
  success: number;
  skipped?: number;
  failed: number;
  downloads: Array<{
    title?: string;
    path?: string;
    url?: string;
    status?: string;
    message?: string;
    sha256?: string;
    size?: number;
  }>;
  errors?: Array<{ title?: string; url?: string; message?: string }>;
  output_dir: string;
}

export interface ScrapeManifestRecord {
  url?: string;
  path?: string;
  filename?: string;
  sha256?: string;
  size?: number;
  downloaded_at?: string;
  title?: string;
  etag?: string | null;
  last_modified?: string | null;
}

export interface ScrapeManifestResponse {
  output_dir: string;
  exists: boolean;
  manifest: {
    version?: number;
    items?: Record<string, ScrapeManifestRecord>;
  };
}

export interface UploadJobResponse {
  job_id: string;
  status: string;
  filename?: string;
  pdf_path?: string;
}

export interface UploadBatchResponse {
  batch_id: string;
  total: number;
  jobs: UploadJobResponse[];
}

export interface UploadJobStatus {
  job_id: string;
  status: string;
  filename?: string;
  pdf_path?: string;
  result?: {
    filename: string;
    pdf_path: string;
    temperatures: unknown[];
  };
  error_message?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface UploadBatchStatus {
  batch_id: string;
  status: string;
  total: number;
  pending: number;
  running: number;
  success: number;
  error: number;
  canceled: number;
  jobs: UploadJobStatus[];
}

export interface DataIssue {
  id: number;
  bulletin_date?: string | null;
  map_type?: string | null;
  code?: string | null;
  message?: string | null;
  severity?: string | null;
  status?: string | null;
  resolved_at?: string | null;
  resolution_note?: string | null;
  details?: Record<string, unknown> | null;
  created_at?: string | null;
  station_name?: string | null;
}

export interface DataIssuesResponse {
  items: DataIssue[];
  total: number;
  limit: number;
  offset: number;
}

export interface DataQualityResponse {
  average_quality?: number | null;
  sample_size: number;
  date?: string | null;
}

export interface TempRetentionSettings {
  keep_days: number;
}

function normalizeBulletinsResponse(payload: unknown): BulletinsResponse {
  const resolved = unwrapData<unknown>(payload);
  if (resolved && typeof resolved === "object") {
    const candidate = resolved as {
      bulletins?: BulletinSummary[];
      items?: BulletinSummary[];
      total?: number;
      limit?: number;
      offset?: number;
    };
    if (Array.isArray(candidate.bulletins)) {
      return {
        bulletins: candidate.bulletins,
        total: candidate.total,
        limit: candidate.limit,
        offset: candidate.offset,
      };
    }
    if (Array.isArray(candidate.items)) {
      return {
        bulletins: candidate.items,
        total: candidate.total,
        limit: candidate.limit,
        offset: candidate.offset,
      };
    }
  }
  return { bulletins: [] };
}

function normalizePipelineRunsResponse(payload: unknown): PipelineRunsResponse {
  const resolved = unwrapData<unknown>(payload);
  if (resolved && typeof resolved === "object") {
    const candidate = resolved as {
      runs?: PipelineRunSummaryDto[];
      items?: PipelineRunSummaryDto[];
      total?: number;
      limit?: number;
      offset?: number;
    };
    if (Array.isArray(candidate.runs)) {
      return {
        runs: candidate.runs,
        total: candidate.total,
        limit: candidate.limit,
        offset: candidate.offset,
      };
    }
    if (Array.isArray(candidate.items)) {
      return {
        runs: candidate.items,
        total: candidate.total,
        limit: candidate.limit,
        offset: candidate.offset,
      };
    }
  }
  return { runs: [] };
}

export async function fetchBulletins(options?: { limit?: number; offset?: number }) {
  const limit = options?.limit ?? 200;
  const offset = options?.offset ?? 0;
  const payload = await requestJson<unknown>(`/bulletins?limit=${limit}&offset=${offset}`);
  return normalizeBulletinsResponse(payload);
}

export async function fetchBulletinByDate(date: string, type?: string) {
  const query = type ? `?type=${type}` : "";
  return requestJson<BulletinDetail>(`/bulletins/${encodeURIComponent(date)}${query}`);
}

export async function ingestManualMetrics(payload: ManualMetricsIngestRequest) {
  return requestJson<ManualMetricsIngestResponse>("/json-metrics/ingest", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function fetchMetricsByDate(date: string) {
  return requestJson<MetricsResponse>(`/metrics/${encodeURIComponent(date)}`);
}

export async function fetchMetricsList(limit = 50) {
  return requestJson<MetricsListResponse>(`/metrics?limit=${limit}`);
}

export interface StationDataRow {
  id: number;
  bulletin_id: number;
  date: string;
  map_type: "observation" | "forecast";
  station_id: number;
  station_name: string;
  latitude?: number | null;
  longitude?: number | null;
  tmin?: number | null;
  tmax?: number | null;
  tmin_raw?: string | null;
  tmax_raw?: string | null;
  weather_condition?: string | null;
  processed_at?: string | null;
}

export interface StationDataResponse {
  items: StationDataRow[];
  total: number;
  limit: number;
  offset: number;
}

export interface StationDataFilters {
  years: number[];
  months: number[];
  stations: string[];
}

export interface StationDataUpdateRequest {
  tmin?: number | null;
  tmax?: number | null;
  tmin_raw?: string | null;
  tmax_raw?: string | null;
  weather_condition?: string | null;
  user?: string | null;
  reason?: string | null;
}

export interface StationDataUpdateResponse {
  status: string;
  updated: boolean;
  row?: StationDataRow | null;
  changes: Array<{ field: string; old_value: unknown; new_value: unknown }>;
}

export interface StationDataHistoryItem {
  id: number;
  weather_data_id?: number | null;
  date?: string | null;
  map_type?: string | null;
  station_name?: string | null;
  field: string;
  old_value?: unknown;
  new_value?: unknown;
  updated_by?: string | null;
  reason?: string | null;
  updated_at?: string | null;
}

export interface StationDataHistoryResponse {
  items: StationDataHistoryItem[];
  total: number;
  limit: number;
  offset: number;
}

export interface AuthMeResponse {
  username: string;
  expires_at: number;
}

export interface AuthLoginResponse {
  access_token: string;
  token_type: string;
  expires_at: number;
}

export async function loginAuth(email: string, password: string) {
  return requestJson<AuthLoginResponse>("/auth/login", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({ username: email, email, password }),
  });
}

export async function fetchAuthMe() {
  return requestJson<AuthMeResponse>("/auth/me");
}

export async function fetchStationDataFilters() {
  return requestJson<StationDataFilters>("/station-data/filters");
}

export async function fetchStationData(params: {
  year?: number;
  month?: number;
  station?: string;
  mapType?: "observation" | "forecast";
  limit?: number;
  offset?: number;
}) {
  const query = new URLSearchParams();
  if (params.year) query.set("year", String(params.year));
  if (params.month) query.set("month", String(params.month));
  if (params.station) query.set("station", params.station);
  if (params.mapType) query.set("map_type", params.mapType);
  if (params.limit) query.set("limit", String(params.limit));
  if (params.offset) query.set("offset", String(params.offset));
  const suffix = query.toString() ? `?${query.toString()}` : "";
  return requestJson<StationDataResponse>(`/station-data${suffix}`);
}

export async function updateStationDataRow(rowId: number, payload: StationDataUpdateRequest) {
  return requestJson<StationDataUpdateResponse>(`/station-data/${rowId}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(payload ?? {}),
  });
}

export async function fetchStationDataHistory(params: {
  year?: number;
  month?: number;
  station?: string;
  mapType?: "observation" | "forecast";
  limit?: number;
  offset?: number;
}) {
  const query = new URLSearchParams();
  if (params.year) query.set("year", String(params.year));
  if (params.month) query.set("month", String(params.month));
  if (params.station) query.set("station", params.station);
  if (params.mapType) query.set("map_type", params.mapType);
  if (params.limit) query.set("limit", String(params.limit));
  if (params.offset) query.set("offset", String(params.offset));
  const suffix = query.toString() ? `?${query.toString()}` : "";
  return requestJson<StationDataHistoryResponse>(`/station-data/history${suffix}`);
}

export async function downloadStationDataCsv(params: {
  year?: number;
  month?: number;
  station?: string;
  mapType?: "observation" | "forecast";
}) {
  const query = new URLSearchParams();
  if (params.year) query.set("year", String(params.year));
  if (params.month) query.set("month", String(params.month));
  if (params.station) query.set("station", params.station);
  if (params.mapType) query.set("map_type", params.mapType);
  const suffix = query.toString() ? `?${query.toString()}` : "";
  const url = `${API_BASE}/station-data/export${suffix}`;
  const headers = new Headers({ Accept: "text/csv" });
  attachAuthHeader(headers);
  const response = await fetch(url, { headers });
  if (!response.ok) {
    const text = await response.text();
    throw new ApiError(text || `Request failed (${response.status})`, { status: response.status });
  }
  return response.blob();
}

export interface JsonMetricsFileInfo {
  path: string;
  name: string;
  size_bytes: number;
  modified_at: string;
  date?: string | null;
  month?: string | null;
  year?: number | null;
  map_type?: string | null;
}

export interface JsonMetricsFilesResponse {
  files: JsonMetricsFileInfo[];
  total: number;
}

export interface JsonMetricsFilePayload {
  path: string;
  data: {
    date_bulletin?: string;
    map_type?: string;
    source_image?: string;
    stations?: Array<{
      nom?: string | null;
      tmin?: number | null;
      tmax?: number | null;
      weather_icon?: string | null;
    }>;
  };
}

export async function fetchJsonMetricsFiles() {
  return requestJsonWithFallback<JsonMetricsFilesResponse>(`/json-metrics/files`);
}

export async function fetchJsonMetricsFile(path: string) {
  return requestJsonWithFallback<JsonMetricsFilePayload>(
    `/json-metrics/file?path=${encodeURIComponent(path)}`,
  );
}

export async function recalculateMetrics(force = false) {
  return postJson<{
    status: string;
    message?: string;
    result?: {
      daily?: unknown;
      monthly?: {
        status: string;
        months_aggregated: number;
      };
    };
    observation_count?: number;
    forecast_count?: number;
  }>(`/metrics/recalculate`, { force });
}

export interface MonthlyMetricsResponse {
  year: number;
  month: number;
  mae_tmin?: number | null;
  mae_tmax?: number | null;
  rmse_tmin?: number | null;
  rmse_tmax?: number | null;
  bias_tmin?: number | null;
  bias_tmax?: number | null;
  accuracy_weather?: number | null;
  precision_weather?: number | null;
  recall_weather?: number | null;
  f1_score_weather?: number | null;
  sample_size?: number | null;
  days_evaluated?: number | null;
  calculated_at?: string | null;
}

export interface MonthlyMetricsListResponse {
  items: MonthlyMetricsResponse[];
  total: number;
}

// Station Monthly Metrics Interfaces
export interface StationInfo {
  id: number;
  name: string;
  metrics_count: number;
  last_calculated: string | null;
}

export interface StationListResponse {
  stations: StationInfo[];
  total: number;
}

export interface StationMonthlyMetricsResponse extends MonthlyMetricsResponse {
  station_name: string;
}

export interface StationMonthlyMetricsListResponse {
  items: StationMonthlyMetricsResponse[];
  total: number;
}

export type ContingencyScoreRow = {
  code: string;
  pod: number | null;
  far: number | null;
};

export type ContingencyResponse = {
  labels: string[];
  matrix: number[][];
  pc: number | null;
  rows: ContingencyScoreRow[];
  sample_size: number;
  days_count?: number;
  forecast_offset_days?: number;
  filters: {
    year?: number | null;
    month?: number | null;
    station_id?: number | null;
  };
};

// Station Metrics API Functions
export async function fetchStationsWithMetrics() {
  return requestJson<StationListResponse>(`/metrics/stations`);
}

export async function fetchStationMonthlyMetrics(stationId: number, year: number, month: number) {
  return requestJson<StationMonthlyMetricsResponse>(`/metrics/station/${stationId}/monthly/${year}/${month}`);
}

export async function fetchStationMonthlyMetricsList(stationId: number, limit = 12) {
  return requestJson<StationMonthlyMetricsListResponse>(`/metrics/station/${stationId}/monthly?limit=${limit}`);
}

export async function fetchMonthlyMetrics(year: number, month: number) {
  return requestJson<MonthlyMetricsResponse>(`/metrics/monthly/${year}/${month}`);
}

export async function fetchMonthlyMetricsList(limit = 12) {
  return requestJson<MonthlyMetricsListResponse>(`/metrics-monthly?limit=${limit}`);
}

export async function fetchContingencyMetrics(params: {
  year?: number;
  month?: number;
  stationId?: number;
}) {
  const query = new URLSearchParams();
  if (params.year) query.set("year", String(params.year));
  if (params.month) query.set("month", String(params.month));
  if (params.stationId) query.set("station_id", String(params.stationId));
  const suffix = query.toString() ? `?${query.toString()}` : "";
  return requestJson<ContingencyResponse>(`/metrics/contingency${suffix}`);
}

// Utility function to format months in French (moved here for consistency)
export function formatFrenchMonth(year: number, month: number): string {
  const frenchMonths = [
    "Janvier", "Février", "Mars", "Avril", "Mai", "Juin",
    "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre"
  ];
  
  const monthIndex = month - 1; // Convert to 0-based index
  if (monthIndex >= 0 && monthIndex < 12) {
    return `${frenchMonths[monthIndex]} ${year}`;
  }
  return `${month.toString().padStart(2, '0')}-${year}`;
}

// Utility function to parse YYYY-MM format
export function parseYearMonth(yearMonth: string): { year: number; month: number } | null {
  const parts = yearMonth.split('-');
  if (parts.length !== 2) return null;
  
  const year = parseInt(parts[0], 10);
  const month = parseInt(parts[1], 10);
  
  if (isNaN(year) || isNaN(month) || month < 1 || month > 12) return null;
  
  return { year, month };
}

export async function fetchPipelineRuns() {
  const payload = await requestJson<unknown>("/pipeline/runs?limit=50&offset=0");
  return normalizePipelineRunsResponse(payload);
}

export async function fetchPipelineRunDetail(runId: number) {
  return requestJson<PipelineRunDetailDto>(`/pipeline/runs/${runId}`);
}

export async function triggerPipelineRun(payload: PipelineTriggerRequest) {
  return postJson<PipelineTriggerResponse>("/pipeline/run", payload);
}

export async function stopPipelineRun(runId: number) {
  return postJson<{ message: string }>(`/pipeline/stop/${runId}`, {});
}

export async function skipPipelineStep(runId: number, stepKey: string) {
  return postJson<{ message: string }>(`/pipeline/skip-step/${runId}/${stepKey}`, {});
}

export async function triggerScrape(payload: ScrapeRequest) {
  return postJson<ScrapeResponse>("/scrape", payload);
}

export async function fetchScrapeManifest(outputDir?: string) {
  const query = outputDir ? `?output_dir=${encodeURIComponent(outputDir)}` : "";
  return requestJson<ScrapeManifestResponse>(`/scrape/manifest${query}`);
}

export async function fetchValidationIssues(params?: {
  date?: string;
  station?: string;
  severity?: string;
  status?: string;
  limit?: number;
  offset?: number;
}) {
  const query = new URLSearchParams();
  if (params?.date) query.set("date", params.date);
  if (params?.station) query.set("station", params.station);
  if (params?.severity) query.set("severity", params.severity);
  if (params?.status) query.set("status", params.status);
  if (params?.limit) query.set("limit", String(params.limit));
  if (params?.offset) query.set("offset", String(params.offset));
  const suffix = query.toString() ? `?${query.toString()}` : "";
  return requestJson<DataIssuesResponse>(`/validation/issues${suffix}`);
}

export async function fetchQualitySummary(date?: string) {
  const query = date ? `?date=${encodeURIComponent(date)}` : "";
  return requestJson<DataQualityResponse>(`/validation/quality${query}`);
}

export async function fetchTempRetentionSettings() {
  return requestJson<TempRetentionSettings>(`/settings/storage/retention`);
}

export async function updateTempRetentionSettings(keepDays: number) {
  return postJson<TempRetentionSettings>(`/settings/storage/retention`, { keep_days: keepDays });
}

export async function ignoreValidationIssue(issueId: number, note?: string) {
  return postJson<{ status: string; issue_id: number }>(`/validation/issues/${issueId}/ignore`, {
    note,
  });
}

export async function correctTemperature(payload: {
  date: string;
  station_name: string;
  map_type: "observation" | "forecast";
  tmin?: number | null;
  tmax?: number | null;
  issue_id?: number;
}) {
  return postJson<{ status: string; updated: number }>(`/validation/temperature-correction`, payload);
}

export async function uploadBulletinsBatch(files: File[]) {
  const formData = new FormData();
  files.forEach((file) => formData.append("files", file));
  startRequest();
  try {
    const response = await fetch(`${API_BASE}/upload-bulletins`, {
      method: "POST",
      body: formData,
    });
    const text = await response.text();
    let payload: unknown = null;
    if (text) {
      try {
        payload = JSON.parse(text);
      } catch {
        payload = null;
      }
    }
    if (!response.ok) {
      const message =
        (payload as { detail?: string })?.detail || `Request failed (${response.status})`;
      reportError(message);
      throw new ApiError(message, { status: response.status });
    }
    if (!payload) {
      throw new ApiError("Invalid response from server.");
    }
    return payload as UploadBatchResponse;
  } finally {
    finishRequest();
  }
}

export async function fetchUploadBatchStatus(batchId: string) {
  return requestJson<UploadBatchStatus>(`/upload-bulletins/batches/${encodeURIComponent(batchId)}`);
}

export async function stopUploadBatch(batchId: string) {
  return postJson<{ batch_id: string; status: string }>(
    `/upload-bulletins/batches/${encodeURIComponent(batchId)}/stop`,
    {}
  );
}

export async function regenerateBulletinTranslation(payload: {
  date: string;
  station_name: string;
  language?: string | null;
}) {
  return postJson<{
    status: string;
    station: string;
    date: string;
    translations: Record<string, string>;
  }>(`/bulletins/regenerate-translation`, payload);
}

// Nouvelle version asynchrone (non-bloquante)
export async function regenerateBulletinTranslationAsync(payload: {
  date: string;
  station_name: string;
  language?: string | null;
}) {
  return postJson<{
    task_id: string;
    status: string;
    message: string;
    poll_url: string;
  }>(`/bulletins/regenerate-translation-async`, payload);
}

export async function getTranslationTaskStatus(taskId: string) {
  return requestJson<{
    task_id: string;
    status: "pending" | "running" | "completed" | "failed" | "cancelled";
    task_type: string;
    created_at: string | null;
    started_at: string | null;
    finished_at: string | null;
    progress: number;
    metadata: Record<string, any>;
    result?: {
      status: string;
      station: string;
      date: string;
      translations: Record<string, string>;
      rows_updated: number;
    };
    error?: string;
  }>(`/bulletins/translation-task/${encodeURIComponent(taskId)}`);
}

export async function listTranslationTasks(status?: string) {
  const query = status ? `?status=${encodeURIComponent(status)}` : "";
  return requestJson<{
    tasks: Array<{
      task_id: string;
      status: string;
      task_type: string;
      created_at: string | null;
      started_at: string | null;
      finished_at: string | null;
      metadata: Record<string, any>;
    }>;
    total: number;
    running_count: number;
  }>(`/bulletins/translation-tasks${query}`);
}

export async function cancelTranslationTask(taskId: string) {
  return requestJson<{
    task_id: string;
    status: string;
    message: string;
  }>(`/bulletins/translation-task/${encodeURIComponent(taskId)}`, {
    method: "DELETE",
  });
}

// Types pour les nouvelles fonctionnalités de traduction
export type TranslationResult = {
  language: string;
  text: string;
  translated_at: string;
  source_text: string;
};

export type BulletinTranslationResponse = {
  date: string;
  french_text: string | null;
  moore_translation: string | null;
  dioula_translation: string | null;
  extracted_at: string | null;
  translations: TranslationResult[];
};

// Services de traduction
export async function getBulletinTranslations(date: string): Promise<BulletinTranslationResponse> {
  return requestJson<BulletinTranslationResponse>(`/bulletins/${encodeURIComponent(date)}/translations`);
}

export async function extractBulletinText(date: string): Promise<{ 
  status: string; 
  date: string; 
  extracted_text: string; 
  extracted_at: string 
}> {
  return postJson<{ 
    status: string; 
    date: string; 
    extracted_text: string; 
    extracted_at: string 
  }>(`/bulletins/${encodeURIComponent(date)}/extract-text`, {});
}

export async function translateBulletin(
  date: string, 
  languages: string[] = ['moore', 'dioula']
): Promise<{ 
  status: string; 
  date: string; 
  translations: Record<string, string>;
  rows_updated: number;
}> {
  const params = new URLSearchParams();
  languages.forEach(lang => params.append('languages', lang));
  
  return postJson<{ 
    status: string; 
    date: string; 
    translations: Record<string, string>;
    rows_updated: number;
  }>(`/bulletins/${encodeURIComponent(date)}/translate?${params}`, {});
}

export type BulletinReprocessStartResponse = {
  batch_id: string;
  total: number;
  status: "pending" | "running" | "completed" | "failed";
  message?: string;
};

export type BulletinReprocessStatus = {
  batch_id: string;
  status: "pending" | "running" | "completed" | "failed";
  progress: {
    current: number;
    total: number;
    success: number;
    failed: number;
    skipped: number;
    missing: number;
  };
  errors?: string[];
  error?: string;
};

export async function startBulletinsReprocess() {
  return postJson<BulletinReprocessStartResponse>(`/bulletins/reprocess`, {});
}

export async function getBulletinsReprocessStatus(batchId: string) {
  return requestJson<BulletinReprocessStatus>(
    `/bulletins/reprocess/${encodeURIComponent(batchId)}`
  );
}
