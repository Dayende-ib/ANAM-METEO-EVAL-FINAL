import { useEffect, useMemo, useState } from "react";
import { Layout } from "../components/Layout";
import { fetchTempRetentionSettings, updateTempRetentionSettings } from "../services/api";
import { DEBUG_MODE } from "../config";

const SETTINGS_KEY = "anam-settings";
const THEME_KEY = "anam-theme";

type ThemeMode = "system" | "light" | "dark";

type Settings = {
  appearance: {
    theme: ThemeMode;
    textScale: number;
    compactMode: boolean;
    reduceMotion: boolean;
  };
  pipeline: {
    autoRun: boolean;
    intervalMinutes: number;
    pollOnlyWhenRunning: boolean;
    notifyOnFinish: boolean;
  };
  cache: {
    enabled: boolean;
    ttlMinutes: number;
    offlineFallback: boolean;
  };
  security: {
    requireLogin: boolean;
    restrictOrigins: boolean;
    protectApiKeys: boolean;
  };
  storage: {
    keepDays: number;
  };
  diagnostics: {
    logLevel: "info" | "warning" | "debug";
    exportOnError: boolean;
    showServiceStatus: boolean;
  };
};

const DEFAULT_SETTINGS: Settings = {
  appearance: {
    theme: "system",
    textScale: 100,
    compactMode: false,
    reduceMotion: false,
  },
  pipeline: {
    autoRun: true,
    intervalMinutes: 60,
    pollOnlyWhenRunning: true,
    notifyOnFinish: true,
  },
  cache: {
    enabled: true,
    ttlMinutes: 5,
    offlineFallback: true,
  },
  security: {
    requireLogin: true,
    restrictOrigins: true,
    protectApiKeys: true,
  },
  storage: {
    keepDays: 7,
  },
  diagnostics: {
    logLevel: "info",
    exportOnError: false,
    showServiceStatus: true,
  },
};

const deepMerge = <T,>(base: T, override: Partial<T>): T => {
  if (!override || typeof override !== "object") {
    return base;
  }
  const result: any = Array.isArray(base) ? [...base] : { ...base };
  Object.entries(override).forEach(([key, value]) => {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      result[key] = deepMerge((result as any)[key], value as any);
    } else if (value !== undefined) {
      result[key] = value;
    }
  });
  return result;
};

const loadSettings = (): Settings => {
  if (typeof window === "undefined") return DEFAULT_SETTINGS;
  try {
    const raw = window.localStorage.getItem(SETTINGS_KEY);
    const storedTheme = window.localStorage.getItem(THEME_KEY);
    const base = { ...DEFAULT_SETTINGS };
    if (!raw) {
      if (storedTheme === "dark" || storedTheme === "light") {
        base.appearance = { ...base.appearance, theme: storedTheme };
      }
      return base;
    }
    const parsed = JSON.parse(raw) as Partial<Settings>;
    const merged = deepMerge(base, parsed);
    // anam-theme (set by the header toggle) always takes priority over saved settings
    if (storedTheme === "dark" || storedTheme === "light") {
      merged.appearance = { ...merged.appearance, theme: storedTheme };
    }
    return merged;
  } catch {
    return DEFAULT_SETTINGS;
  }
};

const ToggleRow = ({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) => (
  <div className="flex items-start justify-between gap-4 rounded-2xl border border-[var(--border)] bg-[var(--surface-strong)] px-4 py-3">
    <div>
      <p className="text-sm font-semibold text-ink">{label}</p>
      <p className="text-xs text-muted mt-1">{description}</p>
    </div>
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`relative h-7 w-12 rounded-full border border-[var(--border)] transition-colors ${
        checked
          ? "bg-gradient-to-br from-primary-500 to-secondary-600"
          : "bg-[var(--canvas-strong)]"
      }`}
    >
      <span
        className={`absolute top-1 left-1 h-5 w-5 rounded-full bg-white shadow transition-transform ${
          checked ? "translate-x-5" : ""
        }`}
      />
    </button>
  </div>
);

const InputRow = ({
  label,
  description,
  value,
  onChange,
  type = "text",
  min,
  step,
}: {
  label: string;
  description: string;
  value: string | number;
  onChange: (value: string) => void;
  type?: "text" | "number";
  min?: number;
  step?: number;
}) => (
  <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-strong)] px-4 py-3">
    <label className="block text-sm font-semibold text-ink">{label}</label>
    <p className="text-xs text-muted mt-1">{description}</p>
    <input
      type={type}
      value={value}
      min={min}
      step={step}
      onChange={(event) => onChange(event.target.value)}
      className="mt-3 w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
    />
  </div>
);

const SelectRow = ({
  label,
  description,
  value,
  onChange,
  options,
}: {
  label: string;
  description: string;
  value: string | number;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
}) => (
  <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-strong)] px-4 py-3">
    <label className="block text-sm font-semibold text-ink">{label}</label>
    <p className="text-xs text-muted mt-1">{description}</p>
    <select
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className="mt-3 w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  </div>
);

export function ParametresPage() {
  const [settings, setSettings] = useState<Settings>(() => loadSettings());
  const [storageSaving, setStorageSaving] = useState(false);
  const [storageMessage, setStorageMessage] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  }, [settings]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const theme = settings.appearance.theme;
    if (theme === "system") {
      window.localStorage.removeItem(THEME_KEY);
      document.documentElement.classList.toggle(
        "dark",
        window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false
      );
    } else {
      window.localStorage.setItem(THEME_KEY, theme);
      document.documentElement.classList.toggle("dark", theme === "dark");
    }
    if (typeof StorageEvent !== "undefined") {
      const newValue = theme === "system" ? null : theme;
      window.dispatchEvent(new StorageEvent("storage", { key: THEME_KEY, newValue }));
    }
  }, [settings.appearance.theme]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    document.documentElement.style.fontSize = `${settings.appearance.textScale}%`;
    document.documentElement.dataset.density = settings.appearance.compactMode ? "compact" : "comfortable";
    document.documentElement.dataset.motion = settings.appearance.reduceMotion ? "reduced" : "full";
  }, [settings.appearance]);

  useEffect(() => {
    let active = true;
    const loadRetention = async () => {
      try {
        const data = await fetchTempRetentionSettings();
        if (!active) return;
        if (typeof data.keep_days === "number" && data.keep_days > 0) {
          setSettings((prev) => ({
            ...prev,
            storage: { ...prev.storage, keepDays: data.keep_days },
          }));
        }
      } catch {
        // ignore load errors, keep local defaults
      }
    };
    loadRetention();
    return () => {
      active = false;
    };
  }, []);

  const update = <K extends keyof Settings>(key: K, value: Settings[K]) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
  };

  const clearCache = () => {
    if (typeof window === "undefined") return;
    const keys = Object.keys(window.localStorage);
    keys.forEach((key) => {
      if (key.startsWith("api_cache:")) {
        window.localStorage.removeItem(key);
      }
    });
  };

  const resetDefaults = () => {
    setSettings(DEFAULT_SETTINGS);
  };

  const saveStorageRetention = async () => {
    setStorageSaving(true);
    setStorageMessage(null);
    try {
      const keepDays = Math.max(1, Math.floor(settings.storage.keepDays));
      const data = await updateTempRetentionSettings(keepDays);
      setSettings((prev) => ({
        ...prev,
        storage: { ...prev.storage, keepDays: data.keep_days },
      }));
      setStorageMessage("Durée de conservation enregistrée.");
    } catch (error) {
      setStorageMessage(
        error instanceof Error ? error.message : "Impossible d'enregistrer ce paramètre."
      );
    } finally {
      setStorageSaving(false);
    }
  };

  const themeOptions = useMemo(
    () => [
      { value: "system", label: "Suivre le système" },
      { value: "light", label: "Toujours clair" },
      { value: "dark", label: "Toujours sombre" },
    ],
    []
  );

  return (
    <Layout title="Paramètres">
      <div className="space-y-6">
        <section className="surface-panel soft p-6">
          <h2 className="text-2xl font-semibold text-ink font-display">Centre de réglages</h2>
          <p className="mt-2 text-sm text-muted">
            Chaque réglage agit sur l'expérience utilisateur ou la qualité des données. Les valeurs
            sont enregistrées localement sur cet ordinateur.
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={resetDefaults}
              className="rounded-full border border-[var(--border)] px-4 py-2 text-xs font-semibold text-ink hover:bg-[var(--canvas-strong)] transition-colors"
            >
              Réinitialiser les valeurs
            </button>
            <button
              type="button"
              onClick={clearCache}
              className="rounded-full border border-[var(--border)] px-4 py-2 text-xs font-semibold text-ink hover:bg-[var(--canvas-strong)] transition-colors"
            >
              Purger le cache local
            </button>
          </div>
        </section>

        <div className="grid gap-6 lg:grid-cols-2">
          <section className="surface-panel p-6 space-y-4">
            <h3 className="text-lg font-semibold text-ink font-display">Apparence</h3>
            <p className="text-sm text-muted">
              Personnalise le rendu visuel. Idéal pour améliorer la lisibilité en salle ou sur écran
              partagé.
            </p>
            <SelectRow
              label="Thème d'affichage"
              description="Choisissez si l'application suit le thème du système ou impose un mode."
              value={settings.appearance.theme}
              options={themeOptions}
              onChange={(value) => update("appearance", { ...settings.appearance, theme: value as ThemeMode })}
            />
            <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-strong)] px-4 py-3 text-xs text-muted">
              Thème actif :{" "}
              <span className="text-ink font-semibold">
                {settings.appearance.theme === "system"
                  ? "Suivi du système"
                  : settings.appearance.theme === "dark"
                    ? "Mode sombre"
                    : "Mode clair"}
              </span>
            </div>
            <SelectRow
              label="Taille du texte"
              description="Augmente la taille si les chiffres sont difficiles à lire."
              value={String(settings.appearance.textScale)}
              options={[
                { value: "90", label: "Petit (90%)" },
                { value: "100", label: "Normal (100%)" },
                { value: "110", label: "Confort (110%)" },
                { value: "120", label: "Large (120%)" },
              ]}
              onChange={(value) => update("appearance", { ...settings.appearance, textScale: Number(value) })}
            />
            <ToggleRow
              label="Mode compact"
              description="Réduit les espacements pour afficher plus d'informations."
              checked={settings.appearance.compactMode}
              onChange={(value) => update("appearance", { ...settings.appearance, compactMode: value })}
            />
            <ToggleRow
              label="Réduire les animations"
              description="Limite les animations pour un affichage plus stable."
              checked={settings.appearance.reduceMotion}
              onChange={(value) => update("appearance", { ...settings.appearance, reduceMotion: value })}
            />
          </section>

          <section className="surface-panel p-6 space-y-4">
            <h3 className="text-lg font-semibold text-ink font-display">Pipeline</h3>
            <p className="text-sm text-muted">
              Définit comment le pipeline s'exécute et comment l'application vous informe.
            </p>
            <ToggleRow
              label="Exécution automatique"
              description="Active le lancement automatique du pipeline quand de nouveaux bulletins sont détectés."
              checked={settings.pipeline.autoRun}
              onChange={(value) => update("pipeline", { ...settings.pipeline, autoRun: value })}
            />
            <InputRow
              label="Intervalle de vérification (minutes)"
              description="Fréquence à laquelle on vérifie si de nouveaux bulletins sont disponibles."
              type="number"
              min={5}
              step={5}
              value={settings.pipeline.intervalMinutes}
              onChange={(value) =>
                update("pipeline", { ...settings.pipeline, intervalMinutes: Number(value || 0) })
              }
            />
            <ToggleRow
              label="Polling uniquement en cours d'exécution"
              description="Réduit les appels API en suivant le pipeline seulement lorsqu'il est en cours."
              checked={settings.pipeline.pollOnlyWhenRunning}
              onChange={(value) => update("pipeline", { ...settings.pipeline, pollOnlyWhenRunning: value })}
            />
            <ToggleRow
              label="Notification de fin"
              description="Affiche un message quand le pipeline termine."
              checked={settings.pipeline.notifyOnFinish}
              onChange={(value) => update("pipeline", { ...settings.pipeline, notifyOnFinish: value })}
            />
          </section>


          <section className="surface-panel p-6 space-y-4">
            <h3 className="text-lg font-semibold text-ink font-display">Cache & mode hors-ligne</h3>
            <p className="text-sm text-muted">
              Conserve des données locales pour continuer à consulter l'application même si l'API est lente.
            </p>
            <ToggleRow
              label="Activer le cache"
              description="Conserve temporairement les réponses API pour accélérer la navigation."
              checked={settings.cache.enabled}
              onChange={(value) => update("cache", { ...settings.cache, enabled: value })}
            />
            <InputRow
              label="Durée de cache (minutes)"
              description="Durée maximale pendant laquelle les données restent valides."
              type="number"
              min={1}
              value={settings.cache.ttlMinutes}
              onChange={(value) => update("cache", { ...settings.cache, ttlMinutes: Number(value || 0) })}
            />
            <ToggleRow
              label="Mode dégradé"
              description="Affiche les derniers résultats connus si l'API ne répond plus."
              checked={settings.cache.offlineFallback}
              onChange={(value) => update("cache", { ...settings.cache, offlineFallback: value })}
            />
          </section>

          <section className="surface-panel p-6 space-y-4">
            <h3 className="text-lg font-semibold text-ink font-display">Sécurité & accès</h3>
            <p className="text-sm text-muted">
              Protège l'accès aux actions sensibles. Les vrais identifiants restent côté serveur.
            </p>
            <ToggleRow
              label="Demander une connexion"
              description="Exige un identifiant avant d'accéder aux commandes sensibles."
              checked={settings.security.requireLogin}
              onChange={(value) => update("security", { ...settings.security, requireLogin: value })}
            />
            <ToggleRow
              label="Limiter aux origines autorisées"
              description="Empêche les accès depuis des sites non déclarés."
              checked={settings.security.restrictOrigins}
              onChange={(value) => update("security", { ...settings.security, restrictOrigins: value })}
            />
            <ToggleRow
              label="Masquer les clés API"
              description="Cache les clés visibles pour éviter une fuite accidentelle."
              checked={settings.security.protectApiKeys}
              onChange={(value) => update("security", { ...settings.security, protectApiKeys: value })}
            />
          </section>

          <section className="surface-panel p-6 space-y-4">
            <h3 className="text-lg font-semibold text-ink font-display">Stockage</h3>
            <p className="text-sm text-muted">
              Gère la durée de conservation des fichiers temporaires.
            </p>
            <InputRow
              label="Conservation des fichiers temporaires (jours)"
              description="Au-delà de ce délai, les fichiers temporaires peuvent être supprimés."
              type="number"
              min={1}
              value={settings.storage.keepDays}
              onChange={(value) => update("storage", { ...settings.storage, keepDays: Number(value || 0) })}
            />
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={saveStorageRetention}
                disabled={storageSaving}
                className="rounded-full border border-[var(--border)] px-4 py-2 text-xs font-semibold text-ink hover:bg-[var(--canvas-strong)] transition-colors disabled:opacity-60"
              >
                {storageSaving ? "Enregistrement..." : "Appliquer"}
              </button>
              {storageMessage && <span className="text-xs text-muted">{storageMessage}</span>}
            </div>
          </section>

          {DEBUG_MODE && (
            <section className="surface-panel p-6 space-y-4">
              <h3 className="text-lg font-semibold text-ink font-display">Diagnostic</h3>
              <p className="text-sm text-muted">
                Aide à investiguer les problèmes ou à partager un rapport.
              </p>
              <SelectRow
                label="Niveau de logs"
                description="Plus le niveau est élevé, plus il y a de détails."
                value={settings.diagnostics.logLevel}
                options={[
                  { value: "info", label: "Info (recommandé)" },
                  { value: "warning", label: "Avertissement uniquement" },
                  { value: "debug", label: "Debug détaillé" },
                ]}
                onChange={(value) =>
                  update("diagnostics", { ...settings.diagnostics, logLevel: value as Settings["diagnostics"]["logLevel"] })
                }
              />
              <ToggleRow
                label="Export automatique en cas d'erreur"
                description="Génère un rapport local si un traitement échoue."
                checked={settings.diagnostics.exportOnError}
                onChange={(value) => update("diagnostics", { ...settings.diagnostics, exportOnError: value })}
              />
              <ToggleRow
                label="Afficher l'état des services"
                description="Montre si l'API, l'OCR et le scraping sont disponibles."
                checked={settings.diagnostics.showServiceStatus}
                onChange={(value) => update("diagnostics", { ...settings.diagnostics, showServiceStatus: value })}
              />
            </section>
          )}
        </div>
      </div>
    </Layout>
  );
}
