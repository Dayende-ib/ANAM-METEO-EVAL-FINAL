export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8000/api/v1";
export const API_CACHE_TTL_MS = Number(import.meta.env.VITE_API_CACHE_TTL_MS ?? "300000");
export const UPLOAD_BATCH_MAX_FILES = Number(
  import.meta.env.VITE_UPLOAD_BATCH_MAX_FILES ?? "500",
);
export const DEBUG_MODE = String(import.meta.env.VITE_DEBUG_MODE ?? "0") === "1";
export const BACKEND_DEBUG_MODE = String(import.meta.env.VITE_BACKEND_DEBUG ?? "0") === "1";

