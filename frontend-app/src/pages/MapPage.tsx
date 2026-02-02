import { useEffect, useMemo, useState } from "react";
import { CircleMarker, MapContainer, TileLayer, Tooltip, useMap } from "react-leaflet";
import { Layout } from "../components/Layout";
import { fetchBulletinByDate, fetchBulletins } from "../services/api";

const BASE_STATIONS = [
  { id: 1, name: "Ouagadougou", lat: 12.35, lng: -1.52 },
  { id: 2, name: "Bobo-Dioulasso", lat: 11.17, lng: -4.32 },
  { id: 3, name: "Kaya", lat: 13.1, lng: -1.08 },
  { id: 4, name: "Dori", lat: 14.03, lng: -0.03 },
  { id: 5, name: "Fada N'Gourma", lat: 12.07, lng: 0.35 },
  { id: 6, name: "Ouahigouya", lat: 13.58, lng: -2.43 },
  { id: 7, name: "Dedougou", lat: 12.47, lng: -3.48 },
  { id: 8, name: "Boromo", lat: 11.75, lng: -2.93 },
  { id: 9, name: "Gaoua", lat: 10.33, lng: -3.18 },
  { id: 10, name: "Po", lat: 11.17, lng: -1.15 },
  { id: 11, name: "Bogande", lat: 12.98, lng: -0.13 },
  { id: 12, name: "Koudougou", lat: 12.25, lng: -2.37 },
  { id: 13, name: "Tenkodogo", lat: 11.77, lng: -0.38 },
];

type Station = {
  id: number;
  name: string;
  lat: number;
  lng: number;
  tmax_obs?: number | null;
  tmin_obs?: number | null;
  tmax_prev?: number | null;
  tmin_prev?: number | null;
  weather_obs?: string | null;
  weather_prev?: string | null;
  quality_score?: number | null;
};

type MetricInfo = { value: number | null; label: string; context?: string };

const CHIPS = ["Toutes les stations", "Ouagadougou", "Bobo-Dioulasso", "Dori"];
const MAP_CENTER = { lat: 12.2383, lng: -1.5616 };
const MAP_ZOOM = 6;

const normalizeName = (value: string) => value.trim().toLowerCase();

function getMetricValue(station: Station, metric: string): MetricInfo {
  if (metric === "Tmax actuel") {
    const value = station.tmax_obs ?? station.tmax_prev ?? null;
    return { value, label: "Tmax", context: station.tmax_obs != null ? "Observation" : "Prévision" }
  }
  if (metric === "Tmin actuel") {
    const value = station.tmin_obs ?? station.tmin_prev ?? null;
    return { value, label: "Tmin", context: station.tmin_obs != null ? "Observation" : "Prévision" }
  }
  if (metric === "Erreur de prédiction RMSE") {
    if (station.tmax_obs != null && station.tmax_prev != null) {
      const value = Math.abs(station.tmax_prev - station.tmax_obs);
      return { value, label: "Erreur Tmax", context: "Diff obs/prev" };
    }
    return { value: null, label: "Erreur Tmax" };
  }
  if (metric === "Météo sensible") {
    const weather = station.weather_obs ?? station.weather_prev ?? "";
    return { value: classifyWeather(weather), label: "Meteo", context: weather || "Aucune info" };
  }
  return { value: null, label: "" };
}

function classifyWeather(weather: string): number | null {
  if (!weather) return null;
  const lowered = weather.toLowerCase();
  const severe = ["orage", "storm", "tempete", "forte pluie", "grele", "violent"];
  const strong = ["pluie", "rain", "vent fort", "ciel charge", "orageux"];
  const mild = ["nuage", "nuageux", "brume", "bruine", "couvert"];
  const calm = ["ensoleille", "clair", "sun", "ciel clair", "beau temps"];
  if (severe.some((token) => lowered.includes(token))) return 4;
  if (strong.some((token) => lowered.includes(token))) return 3;
  if (mild.some((token) => lowered.includes(token))) return 2;
  if (calm.some((token) => lowered.includes(token))) return 1;
  return 1;
}

function getMetricLegend(metric: string) {
  if (metric === "Erreur de prédiction RMSE") {
    return {
      title: "Erreur Tmax (degC)",
      items: [
        { label: "< 1", color: "#10b981" },
        { label: "1 - 2", color: "#3b82f6" },
        { label: "2 - 4", color: "#facc15" },
        { label: "4 - 6", color: "#f97316" },
        { label: "> 6", color: "#ef4444" },
      ],
    };
  }
  if (metric === "Météo sensible") {
    return {
      title: "Meteo sensible",
      items: [
        { label: "Aucune info", color: "#cbd5f5" },
        { label: "Faible", color: "#10b981" },
        { label: "Moderee", color: "#3b82f6" },
        { label: "Forte", color: "#f59e0b" },
        { label: "Severe", color: "#ef4444" },
      ],
    };
  }
  return {
    title: metric === "Tmin actuel" ? "Légende Tmin (degC)" : "Légende Tmax (degC)",
    items: [
      { label: "< 25", color: "#3b82f6" },
      { label: "25 - 30", color: "#22c55e" },
      { label: "30 - 35", color: "#facc15" },
      { label: "35 - 40", color: "#f97316" },
      { label: "> 40", color: "#ef4444" },
    ],
  };
}

function getColorForValue(value: number | null, metric: string): string {
  if (value == null) return "#cbd5f5";
  if (metric === "Erreur de prédiction RMSE") {
    if (value < 1) return "#10b981";
    if (value < 2) return "#3b82f6";
    if (value < 4) return "#facc15";
    if (value < 6) return "#f97316";
    return "#ef4444";
  }
  if (metric === "Météo sensible") {
    if (value <= 1) return "#10b981";
    if (value <= 2) return "#3b82f6";
    if (value <= 3) return "#f59e0b";
    return "#ef4444";
  }
  if (value < 25) return "#3b82f6";
  if (value < 30) return "#22c55e";
  if (value < 35) return "#facc15";
  if (value < 40) return "#f97316";
  return "#ef4444";
}

function MapController({ center, zoom }: { center: { lat: number; lng: number }; zoom: number }) {
  const map = useMap();
  useEffect(() => {
    map.setView([center.lat, center.lng], zoom, { animate: true });
  }, [center, zoom, map]);
  return null;
}

export function MapPage() {
  const [selectedDate, setSelectedDate] = useState<string>("2024-10-26");
  const [selectedMetric, setSelectedMetric] = useState<string>("Tmax actuel");
  const [selectedStations, setSelectedStations] = useState<string[]>(["Toutes les stations"]);
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [selectedStation, setSelectedStation] = useState<number | null>(null);
  const [availableDates, setAvailableDates] = useState<string[]>([]);
  const [stations, setStations] = useState<Station[]>(BASE_STATIONS);
  const [bulletinInterpretations, setBulletinInterpretations] = useState<{
    fr?: string | null;
    moore?: string | null;
    dioula?: string | null;
  }>({});
  const [loadingStations, setLoadingStations] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [mapCenter, setMapCenter] = useState(MAP_CENTER);
  const [mapZoom, setMapZoom] = useState(MAP_ZOOM);

  useEffect(() => {
    let active = true;
    const loadDates = async () => {
      try {
        const data = await fetchBulletins({ limit: 200 });
        if (!active) return;
        const dates = Array.from(new Set(data.bulletins.map((entry) => entry.date))).sort();
        setAvailableDates(dates);
        if (dates.length > 0 && !dates.includes(selectedDate)) {
          setSelectedDate(dates[dates.length - 1]);
        }
      } catch (error) {
        if (!active) return;
        setLoadError(error instanceof Error ? error.message : "Impossible de charger les dates.");
      }
    };
    loadDates();
    return () => {
      active = false;
    };
  }, [selectedDate]);

  useEffect(() => {
    let active = true;
    const loadStations = async () => {
      setLoadingStations(true);
      setLoadError(null);
      try {
        const data = await fetchBulletinByDate(selectedDate);
        if (!active) return;
        
        setBulletinInterpretations({
          fr: data.interpretation_francais,
          moore: data.interpretation_moore,
          dioula: data.interpretation_dioula,
        });

        const byName = new Map<string, Station>();
        BASE_STATIONS.forEach((station) => {
          byName.set(normalizeName(station.name), { ...station });
        });
        data.stations.forEach((station) => {
          const name = station.name ?? "";
          const key = normalizeName(name);
          const base = byName.get(key);
          const merged: Station = {
            id: base?.id ?? byName.size + 1,
            name: name || base?.name || "Station",
            lat: base?.lat ?? station.latitude ?? MAP_CENTER.lat,
            lng: base?.lng ?? station.longitude ?? MAP_CENTER.lng,
            tmax_obs: station.tmax_obs ?? base?.tmax_obs ?? null,
            tmin_obs: station.tmin_obs ?? base?.tmin_obs ?? null,
            tmax_prev: station.tmax_prev ?? base?.tmax_prev ?? null,
            tmin_prev: station.tmin_prev ?? base?.tmin_prev ?? null,
            weather_obs: station.weather_obs ?? base?.weather_obs ?? null,
            weather_prev: station.weather_prev ?? base?.weather_prev ?? null,
            quality_score: station.quality_score ?? base?.quality_score ?? null,
          };
          byName.set(key, merged);
        });
        const mergedStations = Array.from(byName.values()).filter((entry: Station) =>
          Number.isFinite(entry.lat) && Number.isFinite(entry.lng)
        );
        setStations(mergedStations);
      } catch (error) {
        if (!active) return;
        setLoadError(error instanceof Error ? error.message : "Impossible de charger les stations.");
      } finally {
        if (active) {
          setLoadingStations(false);
        }
      }
    };
    if (selectedDate) {
      loadStations();
    }
    return () => {
      active = false;
    };
  }, [selectedDate]);

  const legend = useMemo(() => getMetricLegend(selectedMetric), [selectedMetric]);

  const handleDateChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSelectedDate(e.target.value);
  };

  const handleMetricChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setSelectedMetric(e.target.value);
  };

  const handleStationChange = (station: string, checked: boolean) => {
    if (station === "Toutes les stations") {
      if (checked) {
        setSelectedStations(["Toutes les stations", "Ouagadougou", "Bobo-Dioulasso", "Dori", "Autres"]);
      } else {
        setSelectedStations([]);
      }
      return;
    }

    if (checked) {
      const newStations = [...selectedStations, station];
      setSelectedStations(newStations);
      const allIndividualStations = ["Ouagadougou", "Bobo-Dioulasso", "Dori", "Autres"];
      if (allIndividualStations.every((s) => newStations.includes(s))) {
        setSelectedStations(["Toutes les stations", ...allIndividualStations]);
      }
    } else {
      const newStations = selectedStations.filter((s) => s !== station);
      setSelectedStations(newStations);
      if (selectedStations.includes("Toutes les stations")) {
        setSelectedStations(newStations.filter((s) => s !== "Toutes les stations"));
      }
    }
  };

  const handleSearch = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchQuery(e.target.value);
  };

  const filteredStations = stations.filter((station) => {
    const matchesSearch = station.name.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesFilter =
      selectedStations.includes("Toutes les stations") ||
      selectedStations.includes(station.name) ||
      (selectedStations.includes("Autres") &&
        !["Ouagadougou", "Bobo-Dioulasso", "Dori"].includes(station.name));
    return matchesSearch && matchesFilter;
  });

  const selectedStationData = stations.find((station) => station.id === selectedStation) ?? null;
  const selectedMetricInfo = selectedStationData ? getMetricValue(selectedStationData, selectedMetric) : null;

  const handleStationSelect = (stationId: number) => {
    if (stationId === selectedStation) {
      setSelectedStation(null);
      setMapCenter(MAP_CENTER);
      setMapZoom(MAP_ZOOM);
      return;
    }
    const station = stations.find((entry) => entry.id === stationId);
    setSelectedStation(stationId);
    if (station) {
      setMapCenter({ lat: station.lat, lng: station.lng });
      setMapZoom(7);
    }
  };

  const isStationChecked = (station: string) => {
    if (station === "Toutes les stations") {
      const allStations = ["Ouagadougou", "Bobo-Dioulasso", "Dori", "Autres"];
      return allStations.every((s) => selectedStations.includes(s));
    }
    return selectedStations.includes(station);
  };

  return (
    <Layout title="Carte interactive">
      <div className="flex flex-col lg:flex-row">
        <aside className="flex w-full lg:w-72 flex-col border-r border-[var(--border)]/10 bg-[var(--surface)] p-6 gap-6 overflow-y-auto min-h-0">
          <div>
            <h2 className="text-2xl font-bold text-ink">Controles</h2>
          </div>
          <div className="flex flex-col gap-3">
            <label className="text-sm font-medium text-ink">Date</label>
            <input
              type="date"
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2"
              value={selectedDate}
              onChange={handleDateChange}
              min={availableDates[0]}
              max={availableDates[availableDates.length - 1]}
            />
            {availableDates.length > 0 && (
              <p className="text-xs text-muted">{availableDates.length} dates disponibles</p>
            )}
          </div>
          <div className="flex flex-col gap-3">
            <label className="text-sm font-medium text-ink">Métrique</label>
            <select
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2"
              value={selectedMetric}
              onChange={handleMetricChange}
            >
              <option value="Tmax actuel">Tmax actuel</option>
              <option value="Tmin actuel">Tmin actuel</option>
              <option value="Erreur de prédiction RMSE">Erreur de prédiction RMSE</option>
              <option value="Météo sensible">Météo sensible</option>
            </select>
          </div>
          <div className="flex flex-col gap-2">
            <span className="text-sm font-medium text-ink">Stations</span>
            {["Toutes les stations", "Ouagadougou", "Bobo-Dioulasso", "Dori", "Autres"].map((station) => (
              <label key={station} className="flex items-center gap-2 text-ink">
                <input
                  type="checkbox"
                  className="rounded border-[var(--border)] text-primary focus:ring-primary/50"
                  checked={isStationChecked(station)}
                  onChange={(e) => handleStationChange(station, e.target.checked)}
                />
                {station}
              </label>
            ))}
          </div>
          <div>
            <p className="text-sm font-medium text-ink mb-2">{legend.title}</p>
            <div className="space-y-2 text-sm text-muted">
              {legend.items.map((item) => (
                <div key={item.label} className="flex items-center gap-2">
                  <span className="h-4 w-4 rounded-full" style={{ backgroundColor: item.color }} /> {item.label}
                </div>
              ))}
            </div>
          </div>
        </aside>
        <section className="flex flex-1 flex-col gap-4 p-6 min-h-0">
          <header>
            <h1 className="text-4xl font-black tracking-tight text-ink">Carte interactive</h1>
            <p className="text-muted">
              {selectedMetric} pour le {new Date(selectedDate).toLocaleDateString("fr-FR")}
            </p>
            {loadError && <p className="text-xs text-red-500">{loadError}</p>}
          </header>
          <div className="flex flex-wrap gap-2">
            {CHIPS.map((chip) => (
              <button
                key={chip}
                className={`flex h-9 items-center rounded-full px-4 text-sm font-medium ${
                  selectedStations.includes(chip)
                    ? "bg-primary/10 text-primary"
                    : "bg-[var(--surface)] ring-1 ring-inset ring-[var(--border)] text-ink"
                }`}
                onClick={() => {
                  if (chip === "Toutes les stations") {
                    setSelectedStations(["Toutes les stations", "Ouagadougou", "Bobo-Dioulasso", "Dori", "Autres"]);
                  } else {
                    setSelectedStations([chip]);
                  }
                }}
              >
                {chip}
              </button>
            ))}
          </div>
          <div className="grid gap-4 lg:grid-cols-[1fr_320px] flex-1 min-h-0">
            <div className="relative flex flex-1 flex-col overflow-hidden rounded-xl border border-[var(--border)]/10 bg-[var(--surface)] min-h-[520px]">
              <MapContainer
                center={[mapCenter.lat, mapCenter.lng]}
                zoom={mapZoom}
                scrollWheelZoom={true}
                className="h-full w-full"
              >
                <TileLayer
                  attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                  url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                />
                <MapController center={mapCenter} zoom={mapZoom} />
                {filteredStations.map((station) => {
                  const metricInfo = getMetricValue(station, selectedMetric);
                  const color = getColorForValue(metricInfo.value, selectedMetric);
                  return (
                    <CircleMarker
                      key={station.id}
                      center={[station.lat, station.lng]}
                      radius={selectedStation === station.id ? 10 : 7}
                      pathOptions={{ color, fillColor: color, fillOpacity: 0.9 }}
                      eventHandlers={{
                        click: () => handleStationSelect(station.id),
                      }}
                    >
                      <Tooltip direction="top" offset={[0, -10]} opacity={0.9}>
                        <div className="text-xs">
                          <div className="font-semibold">{station.name}</div>
                          <div>
                            {metricInfo.label}: {metricInfo.value != null ? metricInfo.value.toFixed(1) : "--"}
                          </div>
                        </div>
                      </Tooltip>
                    </CircleMarker>
                  );
                })}
              </MapContainer>
              <div className="absolute top-4 right-4 flex flex-col gap-2">
                <button
                  className="flex h-10 w-10 items-center justify-center rounded-lg bg-black/70 text-white hover:bg-black/90 transition-colors"
                  onClick={() => setMapZoom((prev) => Math.min(prev + 1, 9))}
                >
                  <span className="material-symbols-outlined">add</span>
                </button>
                <button
                  className="flex h-10 w-10 items-center justify-center rounded-lg bg-black/70 text-white hover:bg-black/90 transition-colors"
                  onClick={() => setMapZoom((prev) => Math.max(prev - 1, 5))}
                >
                  <span className="material-symbols-outlined">remove</span>
                </button>
                <button
                  className="flex h-10 w-10 items-center justify-center rounded-lg bg-black/70 text-white hover:bg-black/90 transition-colors"
                  onClick={() => {
                    setMapCenter(MAP_CENTER);
                    setMapZoom(MAP_ZOOM);
                    setSelectedStation(null);
                  }}
                >
                  <span className="material-symbols-outlined">navigation</span>
                </button>
              </div>
              <div className="absolute top-4 left-4 flex items-center rounded-full bg-black/70 px-3 py-2 text-xs text-white">
                <span className="material-symbols-outlined mr-2 text-sm">search</span>
                <input
                  className="bg-transparent text-xs outline-none placeholder:text-white/60"
                  placeholder="Rechercher une station"
                  value={searchQuery}
                  onChange={handleSearch}
                />
              </div>
              {loadingStations && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/40 text-white text-sm">
                  Chargement des stations...
                </div>
              )}
            </div>
            <aside className="surface-panel p-4 space-y-4 overflow-y-auto max-h-full">
              <div>
                <h2 className="text-lg font-semibold text-ink">Details station</h2>
                <p className="text-xs text-muted">
                  Cliquez sur un marqueur pour afficher les valeurs de la station.
                </p>
              </div>
              {selectedStationData ? (
                <div className="space-y-3 text-sm">
                  <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-strong)] p-3">
                    <p className="text-xs uppercase tracking-[0.2em] text-muted">Station</p>
                    <p className="text-lg font-semibold text-ink">{selectedStationData.name}</p>
                    <p className="text-xs text-muted">
                      {selectedStationData.lat.toFixed(2)}, {selectedStationData.lng.toFixed(2)}
                    </p>
                  </div>
                  <div className="grid gap-2">
                    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-strong)] p-3">
                      <p className="text-xs text-muted">Tmax observation</p>
                      <p className="text-lg font-semibold text-ink">
                        {selectedStationData.tmax_obs ?? "--"}
                      </p>
                    </div>
                    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-strong)] p-3">
                      <p className="text-xs text-muted">Tmin observation</p>
                      <p className="text-lg font-semibold text-ink">
                        {selectedStationData.tmin_obs ?? "--"}
                      </p>
                    </div>
                    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-strong)] p-3">
                      <p className="text-xs text-muted">Tmax prévision</p>
                      <p className="text-lg font-semibold text-ink">
                        {selectedStationData.tmax_prev ?? "--"}
                      </p>
                    </div>
                    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-strong)] p-3">
                      <p className="text-xs text-muted">Tmin prévision</p>
                      <p className="text-lg font-semibold text-ink">
                        {selectedStationData.tmin_prev ?? "--"}
                      </p>
                    </div>
                  </div>
                  <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-strong)] p-3">
                    <p className="text-xs text-muted">Météo</p>
                    <p className="text-sm text-ink">
                      {selectedStationData.weather_obs || selectedStationData.weather_prev || "Aucune info"}
                    </p>
                  </div>
                  <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-strong)] p-3">
                    <p className="text-xs text-muted">Qualité</p>
                    <p className="text-sm text-ink">
                      {selectedStationData.quality_score != null
                        ? selectedStationData.quality_score.toFixed(2)
                        : "--"}
                    </p>
                  </div>
                  {selectedMetricInfo && (
                    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-strong)] p-3">
                      <p className="text-xs text-muted">{selectedMetricInfo.label}</p>
                      <p className="text-lg font-semibold text-ink">
                        {selectedMetricInfo.value != null ? selectedMetricInfo.value.toFixed(1) : "--"}
                      </p>
                      {selectedMetricInfo.context && (
                        <p className="text-xs text-muted">{selectedMetricInfo.context}</p>
                      )}
                    </div>
                  )}
                          
                  {/* National Bulletin for the date */}
                  <div className="border-t border-[var(--border)] pt-4 mt-4 space-y-3">
                    <h3 className="text-xs font-bold uppercase tracking-widest text-muted">Bulletin National</h3>
                    {bulletinInterpretations.fr && (
                      <div className="rounded-xl bg-emerald-50/50 p-3 border border-emerald-100">
                        <p className="text-[10px] font-bold text-emerald-700 uppercase">Français</p>
                        <p className="text-xs text-ink line-clamp-3 hover:line-clamp-none transition-all cursor-pointer">{bulletinInterpretations.fr}</p>
                      </div>
                    )}
                    {bulletinInterpretations.moore && (
                      <div className="rounded-xl bg-blue-50/50 p-3 border border-blue-100">
                        <p className="text-[10px] font-bold text-blue-700 uppercase">Mooré</p>
                        <p className="text-xs text-ink line-clamp-3 hover:line-clamp-none transition-all cursor-pointer">{bulletinInterpretations.moore}</p>
                      </div>
                    )}
                    {bulletinInterpretations.dioula && (
                      <div className="rounded-xl bg-amber-50/50 p-3 border border-amber-100">
                        <p className="text-[10px] font-bold text-amber-700 uppercase">Dioula</p>
                        <p className="text-xs text-ink line-clamp-3 hover:line-clamp-none transition-all cursor-pointer">{bulletinInterpretations.dioula}</p>
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div className="rounded-xl border border-dashed border-[var(--border)] p-4 text-sm text-muted">
                  Aucune station selectionnee.
                </div>
              )}
            </aside>
          </div>
        </section>
      </div>
    </Layout>
  );
}
