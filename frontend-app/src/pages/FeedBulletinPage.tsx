import { useEffect, useMemo, useState } from "react";
import { Layout } from "../components/Layout";
import { ErrorPanel, LoadingPanel } from "../components/StatusPanel";
import { fetchBulletinByDate, type BulletinDetail, type StationPayload } from "../services/api";

type BulletinType = "observation" | "forecast";
type Mode = "both" | BulletinType;

type BulletinState = {
  data: BulletinDetail | null;
  error: string | null;
};

const formatDateInput = (date: Date) => {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const formatNumber = (value?: number | null) => {
  if (value === null || value === undefined || Number.isNaN(value)) return "--";
  return Number.isInteger(value) ? value.toString() : value.toFixed(1);
};

const getStations = (payload: BulletinDetail | null) => payload?.stations ?? [];

function StationTable({ type, stations }: { type: BulletinType; stations: StationPayload[] }) {
  const isObservation = type === "observation";
  return (
    <div className="overflow-auto">
      <table className="w-full text-left text-sm">
        <thead className="text-xs uppercase tracking-[0.2em] text-muted">
          <tr>
            <th className="px-3 py-2">Station</th>
            <th className="px-3 py-2 text-right">Tmin</th>
            <th className="px-3 py-2 text-right">Tmax</th>
            <th className="px-3 py-2">Temps</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--border)]">
          {stations.length === 0 && (
            <tr>
              <td colSpan={4} className="px-3 py-4 text-sm text-muted">
                Aucune station disponible.
              </td>
            </tr>
          )}
          {stations.map((station, index) => (
            <tr key={`${station.name ?? "station"}-${index}`}>
              <td className="px-3 py-2 font-semibold text-ink">{station.name ?? "--"}</td>
              <td className="px-3 py-2 text-right font-mono">
                {formatNumber(isObservation ? station.tmin_obs : station.tmin_prev)}
              </td>
              <td className="px-3 py-2 text-right font-mono">
                {formatNumber(isObservation ? station.tmax_obs : station.tmax_prev)}
              </td>
              <td className="px-3 py-2 text-xs text-muted">
                {isObservation ? station.weather_obs ?? "--" : station.weather_prev ?? "--"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function BulletinCard({
  type,
  state,
  date,
}: {
  type: BulletinType;
  state: BulletinState;
  date: string;
}) {
  const stations = getStations(state.data);
  const stationCount = stations.length;
  const title = type === "observation" ? "Observation" : "Prevision";

  if (state.error) {
    return (
      <div className="surface-panel p-6">
        <h3 className="text-lg font-semibold text-ink">{title}</h3>
        <p className="text-sm text-muted mt-2">{state.error}</p>
      </div>
    );
  }

  if (!state.data) {
    return (
      <div className="surface-panel p-6">
        <h3 className="text-lg font-semibold text-ink">{title}</h3>
        <p className="text-sm text-muted mt-2">Aucun bulletin pour {date}.</p>
      </div>
    );
  }

  return (
    <div className="surface-panel overflow-hidden">
      <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border)] bg-[var(--canvas-strong)]">
        <div>
          <h3 className="text-lg font-semibold text-ink">{title}</h3>
          <p className="text-xs text-muted">{stationCount} station(s)</p>
        </div>
        <span
          className={`inline-flex items-center rounded-full px-2 py-1 text-xs font-semibold ${
            type === "observation" ? "bg-blue-100 text-blue-700" : "bg-emerald-100 text-emerald-700"
          }`}
        >
          {type === "observation" ? "Observation" : "Prevision"}
        </span>
      </div>
      <div className="p-6 space-y-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3">
            <p className="text-xs text-muted">Date bulletin</p>
            <p className="text-sm font-semibold text-ink">{state.data.date_bulletin}</p>
          </div>
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3">
            <p className="text-xs text-muted">Stations</p>
            <p className="text-sm font-semibold text-ink">{stationCount}</p>
          </div>
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3">
            <p className="text-xs text-muted">Type</p>
            <p className="text-sm font-semibold text-ink">{title}</p>
          </div>
        </div>

        {(state.data.interpretation_francais ||
          state.data.interpretation_moore ||
          state.data.interpretation_dioula) && (
          <div className="grid gap-4 md:grid-cols-3">
            <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3">
              <p className="text-xs uppercase tracking-[0.2em] text-muted">Francais</p>
              <p className="text-sm text-ink mt-2">
                {state.data.interpretation_francais ?? "--"}
              </p>
            </div>
            <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3">
              <p className="text-xs uppercase tracking-[0.2em] text-muted">Moore</p>
              <p className="text-sm text-ink mt-2">
                {state.data.interpretation_moore ?? "--"}
              </p>
            </div>
            <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3">
              <p className="text-xs uppercase tracking-[0.2em] text-muted">Dioula</p>
              <p className="text-sm text-ink mt-2">
                {state.data.interpretation_dioula ?? "--"}
              </p>
            </div>
          </div>
        )}

        <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
          <h4 className="text-sm font-semibold text-ink mb-3">Stations</h4>
          <StationTable type={type} stations={stations} />
        </div>
      </div>
    </div>
  );
}

export function FeedBulletinPage() {
  const [date, setDate] = useState(() => formatDateInput(new Date()));
  const [mode, setMode] = useState<Mode>("both");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [observationState, setObservationState] = useState<BulletinState>({ data: null, error: null });
  const [forecastState, setForecastState] = useState<BulletinState>({ data: null, error: null });

  const activeTypes = useMemo<BulletinType[]>(() => {
    if (mode === "both") return ["observation", "forecast"];
    return [mode];
  }, [mode]);

  const loadBulletins = async () => {
    try {
      setLoading(true);
      setError(null);

      const tasks = activeTypes.map(async (type) => {
        try {
          const payload = await fetchBulletinByDate(date, type);
          return { type, payload, error: null };
        } catch (err) {
          const message = err instanceof Error ? err.message : "Bulletin indisponible.";
          return { type, payload: null, error: message };
        }
      });

      const results = await Promise.all(tasks);
      results.forEach((result) => {
        if (result.type === "observation") {
          setObservationState({ data: result.payload, error: result.error });
        } else {
          setForecastState({ data: result.payload, error: result.error });
        }
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur lors du chargement.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadBulletins();
  }, [date, mode]);

  if (loading && !observationState.data && !forecastState.data) {
    return (
      <Layout title="Feed bulletin du jour">
        <LoadingPanel message="Chargement des bulletins du jour..." />
      </Layout>
    );
  }

  if (error) {
    return (
      <Layout title="Feed bulletin du jour">
        <ErrorPanel message={error} onRetry={loadBulletins} />
      </Layout>
    );
  }

  return (
    <Layout title="Feed bulletin du jour">
      <div className="space-y-6">
        <div className="surface-panel p-5 space-y-4">
          <div>
            <h2 className="text-lg font-semibold text-ink">Bulletins du jour</h2>
            <p className="text-sm text-muted">
              Consultez les bulletins meteo du jour avec leurs informations principales.
            </p>
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-xs font-semibold text-muted" htmlFor="feed-date">
                Date
              </label>
              <input
                id="feed-date"
                type="date"
                value={date}
                onChange={(event) => setDate(event.target.value)}
                className="min-w-[160px] rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-semibold text-muted" htmlFor="feed-type">
                Type
              </label>
              <select
                id="feed-type"
                value={mode}
                onChange={(event) => setMode(event.target.value as Mode)}
                className="min-w-[180px] rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"
              >
                <option value="both">Observation + Prevision</option>
                <option value="observation">Observation</option>
                <option value="forecast">Prevision</option>
              </select>
            </div>
            <button
              type="button"
              onClick={loadBulletins}
              className="ml-auto rounded-full border border-[var(--border)] px-4 py-2 text-xs font-semibold text-ink hover:bg-[var(--canvas-strong)]"
            >
              Rafraichir
            </button>
          </div>
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          {activeTypes.includes("observation") && (
            <BulletinCard type="observation" state={observationState} date={date} />
          )}
          {activeTypes.includes("forecast") && (
            <BulletinCard type="forecast" state={forecastState} date={date} />
          )}
        </div>
      </div>
    </Layout>
  );
}
