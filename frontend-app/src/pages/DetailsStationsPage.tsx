import { useEffect, useMemo, useState, useCallback } from "react";
import { Layout } from "../components/Layout";
import { LoadingPanel, ErrorPanel } from "../components/StatusPanel";
import { fetchBulletins, fetchBulletinByDate, type BulletinSummary } from "../services/api";

/* ── Station type ── */
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
  interpretation_francais?: string | null;
  interpretation_moore?: string | null;
  interpretation_dioula?: string | null;
};

const BASE_STATIONS: Station[] = [
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

const normalizeName = (v: string) => v.trim().toLowerCase();
const MAP_CENTER = { lat: 12.2383, lng: -1.5616 };


/* ── Weather icon mapping ── */
function getWeatherIcon(weather: string | null | undefined): {
  icon: string;
  color: string;
  label: string;
} {
  if (!weather) return { icon: "help", color: "text-muted", label: "Inconnu" };
  const w = weather.toLowerCase();
  if (["orage", "storm", "tempete", "grele", "violent"].some((t) => w.includes(t)))
    return { icon: "thunderstorm", color: "text-red-500", label: "Orageux" };
  if (["forte pluie", "pluie", "rain", "averse"].some((t) => w.includes(t)))
    return { icon: "rainy", color: "text-blue-500", label: "Pluvieux" };
  if (["nuage", "nuageux", "couvert", "brume", "bruine"].some((t) => w.includes(t)))
    return { icon: "cloud", color: "text-slate-400", label: "Nuageux" };
  if (["vent", "wind"].some((t) => w.includes(t)))
    return { icon: "air", color: "text-cyan-500", label: "Venteux" };
  if (["ensoleille", "clair", "sun", "beau"].some((t) => w.includes(t)))
    return { icon: "wb_sunny", color: "text-amber-500", label: "Ensoleillé" };
  return { icon: "partly_cloudy_day", color: "text-sky-400", label: "Variable" };
}

function getTempColor(temp: number | null | undefined): string {
  if (temp == null) return "text-muted";
  if (temp >= 40) return "text-red-600";
  if (temp >= 35) return "text-orange-500";
  if (temp >= 30) return "text-amber-500";
  if (temp >= 25) return "text-green-500";
  return "text-blue-500";
}

function getQualityBadge(score: number | null | undefined): { label: string; classes: string } {
  if (score == null) return { label: "N/A", classes: "bg-[var(--canvas-strong)] text-muted" };
  if (score >= 0.8)
    return {
      label: `${(score * 100).toFixed(0)}%`,
      classes: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
    };
  if (score >= 0.5)
    return {
      label: `${(score * 100).toFixed(0)}%`,
      classes: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
    };
  return {
    label: `${(score * 100).toFixed(0)}%`,
    classes: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
  };
}

function getHighlightedValue(
  station: Station,
  metric: string,
): { label: string; value: string; color: string } {
  if (metric === "Tmax actuel") {
    const v = station.tmax_obs ?? station.tmax_prev ?? null;
    return { label: "Tmax", value: v != null ? `${v.toFixed(1)}°C` : "--", color: getTempColor(v) };
  }
  if (metric === "Tmin actuel") {
    const v = station.tmin_obs ?? station.tmin_prev ?? null;
    return { label: "Tmin", value: v != null ? `${v.toFixed(1)}°C` : "--", color: getTempColor(v) };
  }
  if (metric === "Erreur de prédiction RMSE") {
    if (station.tmax_obs != null && station.tmax_prev != null) {
      const err = Math.abs(station.tmax_prev - station.tmax_obs);
      const color =
        err < 1
          ? "text-green-500"
          : err < 2
            ? "text-blue-500"
            : err < 4
              ? "text-amber-500"
              : "text-red-500";
      return { label: "Erreur Tmax", value: `${err.toFixed(2)}°C`, color };
    }
    return { label: "Erreur Tmax", value: "--", color: "text-muted" };
  }
  const weather = station.weather_obs ?? station.weather_prev ?? null;
  const wIcon = getWeatherIcon(weather);
  return { label: "Météo", value: wIcon.label, color: wIcon.color };
}

/* ── Slider config ── */
const CARDS_DESKTOP = 3;
const CARDS_TABLET = 2;
const CARDS_MOBILE = 1;

export function DetailsStationsPage() {
  const [selectedDate, setSelectedDate] = useState<string>("");
  const [availableDates, setAvailableDates] = useState<string[]>([]);
  const [stations, setStations] = useState<Station[]>(BASE_STATIONS);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [sliderIndex, setSliderIndex] = useState(0);
  const [cardsPerView, setCardsPerView] = useState(CARDS_DESKTOP);
  const [expandedStation, setExpandedStation] = useState<Station | null>(null);
  const [bulletinInterpretations, setBulletinInterpretations] = useState<{
    francais?: string | null;
    moore?: string | null;
    dioula?: string | null;
  }>({});

  /* ── Responsive ── */
  useEffect(() => {
    const update = () => {
      const w = window.innerWidth;
      if (w < 640) setCardsPerView(CARDS_MOBILE);
      else if (w < 1024) setCardsPerView(CARDS_TABLET);
      else setCardsPerView(CARDS_DESKTOP);
    };
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  /* ── Load available dates ── */
  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const payload = await fetchBulletins({ limit: 200 });
        if (!active) return;
        const dates = Array.from(
          new Set((payload.bulletins as BulletinSummary[]).map((b) => b.date).filter(Boolean)),
        ).sort();
        setAvailableDates(dates);
        if (dates.length > 0) setSelectedDate(dates[dates.length - 1]);
      } catch {
        if (active) setError("Impossible de charger les dates.");
      }
    };
    load();
    return () => {
      active = false;
    };
  }, []);

  /* ── Load stations ── */
  useEffect(() => {
    if (!selectedDate) return;
    let active = true;
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const data = await fetchBulletinByDate(selectedDate);
        if (!active) return;
        const byName = new Map<string, Station>();
        BASE_STATIONS.forEach((s) => byName.set(normalizeName(s.name), { ...s }));
        data.stations.forEach((s) => {
          const name = s.name ?? "";
          const key = normalizeName(name);
          const base = byName.get(key);
          byName.set(key, {
            id: base?.id ?? byName.size + 1,
            name: name || base?.name || "Station",
            lat: base?.lat ?? s.latitude ?? MAP_CENTER.lat,
            lng: base?.lng ?? s.longitude ?? MAP_CENTER.lng,
            tmax_obs: s.tmax_obs ?? null,
            tmin_obs: s.tmin_obs ?? null,
            tmax_prev: s.tmax_prev ?? null,
            tmin_prev: s.tmin_prev ?? null,
            weather_obs: s.weather_obs ?? null,
            weather_prev: s.weather_prev ?? null,
            quality_score: s.quality_score ?? null,
            interpretation_francais: s.interpretation_francais ?? null,
            interpretation_moore: s.interpretation_moore ?? null,
            interpretation_dioula: s.interpretation_dioula ?? null,
          });
        });
        setBulletinInterpretations({
          francais: data.interpretation_francais ?? null,
          moore: data.interpretation_moore ?? null,
          dioula: data.interpretation_dioula ?? null,
        });
        setStations(
          Array.from(byName.values()).filter(
            (s) => Number.isFinite(s.lat) && Number.isFinite(s.lng),
          ),
        );
      } catch {
        if (active) setError("Impossible de charger les stations.");
      } finally {
        if (active) setLoading(false);
      }
    };
    load();
    return () => {
      active = false;
    };
  }, [selectedDate]);

  /* ── Filtered stations ── */
  const filtered = useMemo(() => {
    return stations.filter((s) =>
      s.name.toLowerCase().includes(searchQuery.toLowerCase()),
    );
  }, [stations, searchQuery]);

  useEffect(() => {
    setSliderIndex(0);
  }, [searchQuery]);

  const maxIndex = Math.max(0, filtered.length - cardsPerView);
  const prev = useCallback(() => setSliderIndex((i) => Math.max(0, i - 1)), []);
  const next = useCallback(() => setSliderIndex((i) => Math.min(maxIndex, i + 1)), [maxIndex]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") prev();
      if (e.key === "ArrowRight") next();
      if (e.key === "Escape") setExpandedStation(null);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [prev, next]);

  const dateLabel = selectedDate
    ? new Date(selectedDate).toLocaleDateString("fr-FR", {
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric",
      })
    : "--";

  return (
    <Layout title="Détails stations">
      <div className="space-y-6">
        {error && <ErrorPanel message={error} />}

        {/* ── Header + Search ── */}
        <section className="surface-panel soft p-6">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold text-ink font-display">Détails des stations</h1>
              <p className="text-sm text-muted mt-1 capitalize">{dateLabel}</p>
            </div>
            <div className="flex items-center gap-4">
              {/* Search bar */}
              <div className="relative">
                <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-muted text-lg">
                  search
                </span>
                <input
                  type="text"
                  placeholder="Rechercher une station (ville)..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-72 pl-10 pr-4 py-2.5 rounded-full border border-[var(--border)] bg-[var(--surface)] text-sm text-ink focus:outline-none focus:ring-2 focus:ring-primary-500/30 transition-shadow"
                />
              </div>
              <span className="text-xs text-muted font-mono">
                {filtered.length} station{filtered.length > 1 ? "s" : ""}
              </span>
            </div>
          </div>
        </section>

        {loading && <LoadingPanel message="Chargement des stations..." />}

        {/* ── Slider ── */}
        {!loading && filtered.length > 0 && (
          <section className="relative">
            {/* Navigation arrows */}
            <button
              onClick={prev}
              disabled={sliderIndex === 0}
              className="absolute left-0 top-1/2 -translate-y-1/2 -translate-x-2 z-10 flex items-center justify-center size-11 rounded-full bg-[var(--surface)] border border-[var(--border)] shadow-lg text-ink hover:bg-[var(--canvas-strong)] disabled:opacity-30 disabled:cursor-not-allowed transition-all"
            >
              <span className="material-symbols-outlined">chevron_left</span>
            </button>
            <button
              onClick={next}
              disabled={sliderIndex >= maxIndex}
              className="absolute right-0 top-1/2 -translate-y-1/2 translate-x-2 z-10 flex items-center justify-center size-11 rounded-full bg-[var(--surface)] border border-[var(--border)] shadow-lg text-ink hover:bg-[var(--canvas-strong)] disabled:opacity-30 disabled:cursor-not-allowed transition-all"
            >
              <span className="material-symbols-outlined">chevron_right</span>
            </button>

            {/* Cards track */}
            <div className="overflow-hidden mx-6">
              <div
                className="flex transition-transform duration-500 ease-out"
                style={{ transform: `translateX(-${sliderIndex * (100 / cardsPerView)}%)` }}
              >
                {filtered.map((station) => {
                  const weather = station.weather_obs || station.weather_prev || null;
                  const wIcon = getWeatherIcon(weather);
                  const qualityBadge = getQualityBadge(station.quality_score);
                  const highlight = getHighlightedValue(station, "Tmax actuel");

                  return (
                    <div
                      key={station.id}
                      className="flex-shrink-0 px-2"
                      style={{ width: `${100 / cardsPerView}%` }}
                    >
                      <button
                        onClick={() =>
                          setExpandedStation(expandedStation?.id === station.id ? null : station)
                        }
                        className={`w-full text-left surface-panel soft p-5 transition-all duration-300 hover:-translate-y-1 hover:shadow-xl ${
                          expandedStation?.id === station.id
                            ? "ring-2 ring-primary-500 shadow-xl -translate-y-1"
                            : ""
                        }`}
                      >
                        {/* Header */}
                        <div className="flex items-start justify-between mb-4">
                          <div className="flex items-center gap-3">
                            <div className="flex items-center justify-center size-12 rounded-2xl bg-gradient-to-br from-primary-50 to-secondary-50 dark:from-primary-900/30 dark:to-secondary-700/15">
                              <span className={`material-symbols-outlined text-2xl ${wIcon.color}`}>
                                {wIcon.icon}
                              </span>
                            </div>
                            <div>
                              <h3 className="text-base font-semibold text-ink">{station.name}</h3>
                              <p className="text-[11px] text-muted">{wIcon.label}</p>
                            </div>
                          </div>
                          <span
                            className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${qualityBadge.classes}`}
                          >
                            {qualityBadge.label}
                          </span>
                        </div>

                        {/* Highlighted metric */}
                        <div className="rounded-xl bg-gradient-to-r from-primary-900/5 to-secondary-900/5 dark:from-primary-400/5 dark:to-secondary-400/5 border border-primary-200/30 dark:border-primary-700/20 p-3 mb-3">
                          <p className="text-xs uppercase tracking-widest text-ink/60 font-semibold mb-1">
                            {highlight.label}
                          </p>
                          <p className={`text-2xl font-bold font-mono ${highlight.color}`}>
                            {highlight.value}
                          </p>
                        </div>

                        {/* Temperatures grid - AMÉLIORATION PRINCIPALE */}
                        <div className="grid grid-cols-2 gap-2 mb-3">
                          <div className="rounded-xl bg-[var(--canvas-strong)] p-3">
                            <p className="text-xs uppercase tracking-wider text-ink/70 font-semibold mb-1">
                              Tmax obs
                            </p>
                            <p
                              className={`text-xl font-bold font-mono ${getTempColor(station.tmax_obs)}`}
                            >
                              {station.tmax_obs != null ? `${station.tmax_obs.toFixed(1)}°` : "--"}
                            </p>
                          </div>
                          <div className="rounded-xl bg-[var(--canvas-strong)] p-3">
                            <p className="text-xs uppercase tracking-wider text-ink/70 font-semibold mb-1">
                              Tmin obs
                            </p>
                            <p
                              className={`text-xl font-bold font-mono ${getTempColor(station.tmin_obs)}`}
                            >
                              {station.tmin_obs != null ? `${station.tmin_obs.toFixed(1)}°` : "--"}
                            </p>
                          </div>
                          <div className="rounded-xl bg-[var(--canvas-strong)] p-3">
                            <p className="text-xs uppercase tracking-wider text-ink/70 font-semibold mb-1">
                              Tmax prev
                            </p>
                            <p
                              className={`text-lg font-semibold font-mono ${getTempColor(station.tmax_prev)}`}
                            >
                              {station.tmax_prev != null
                                ? `${station.tmax_prev.toFixed(1)}°`
                                : "--"}
                            </p>
                          </div>
                          <div className="rounded-xl bg-[var(--canvas-strong)] p-3">
                            <p className="text-xs uppercase tracking-wider text-ink/70 font-semibold mb-1">
                              Tmin prev
                            </p>
                            <p
                              className={`text-lg font-semibold font-mono ${getTempColor(station.tmin_prev)}`}
                            >
                              {station.tmin_prev != null
                                ? `${station.tmin_prev.toFixed(1)}°`
                                : "--"}
                            </p>
                          </div>
                        </div>

                        {/* Footer */}
                        <div className="flex items-center justify-between text-xs text-muted">
                          <span className="truncate max-w-[60%]">{weather || "Aucune info"}</span>
                          <span className="font-mono text-[11px]">
                            {station.lat.toFixed(2)}, {station.lng.toFixed(2)}
                          </span>
                        </div>
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Dots */}
            {filtered.length > cardsPerView && (
              <div className="flex items-center justify-center gap-1.5 mt-5">
                {Array.from({ length: maxIndex + 1 }).map((_, i) => (
                  <button
                    key={i}
                    onClick={() => setSliderIndex(i)}
                    className={`rounded-full transition-all duration-300 ${
                      i === sliderIndex
                        ? "w-6 h-2 bg-primary-500"
                        : "w-2 h-2 bg-[var(--border)] hover:bg-primary-300"
                    }`}
                  />
                ))}
              </div>
            )}
          </section>
        )}

        {!loading && filtered.length === 0 && (
          <div className="surface-panel p-10 text-center">
            <span className="material-symbols-outlined text-4xl text-primary-300 mb-3">
              location_off
            </span>
            <p className="text-sm text-muted">Aucune station trouvée pour cette recherche.</p>
          </div>
        )}

        {/* ── Expanded detail panel – horizontal multilingual layout ── */}
        {expandedStation &&
          (() => {
            /* ── Multilingual labels ── */
            type LangLabels = {
              interp_station: string;
              interp_bulletin: string;
              no_interp: string;
            };
            const LABELS: Record<string, LangLabels> = {
              Français: {
                interp_station: "Interprétation station",
                interp_bulletin: "Interprétation bulletin",
                no_interp: "Aucune interprétation disponible",
              },
              Mooré: {
                interp_station: "Stasõ wã bãngre",
                interp_bulletin: "Kibar wã bãngre",
                no_interp: "Bãngr ka be ye",
              },
              Dioula: {
                interp_station: "Stasɔn kɔrɔfɔli",
                interp_bulletin: "Kibaru kɔrɔfɔli",
                no_interp: "Kɔrɔfɔli tɛ yen",
              },
            };

            const languages: {
              lang: string;
              flag: string;
              color: string;
              stationText: string | null | undefined;
              bulletinText: string | null | undefined;
            }[] = [
              {
                lang: "Français",
                flag: "translate",
                color: "from-blue-500 to-blue-600",
                stationText: expandedStation.interpretation_francais,
                bulletinText: bulletinInterpretations.francais,
              },
              {
                lang: "Mooré",
                flag: "language",
                color: "from-amber-500 to-orange-500",
                stationText: expandedStation.interpretation_moore,
                bulletinText: bulletinInterpretations.moore,
              },
              {
                lang: "Dioula",
                flag: "forum",
                color: "from-green-500 to-emerald-600",
                stationText: expandedStation.interpretation_dioula,
                bulletinText: bulletinInterpretations.dioula,
              },
            ];

            return (
              <section className="surface-panel p-6 animate-rise">
                {/* Header */}
                <div className="flex items-center justify-between mb-6">
                  <div className="flex items-center gap-3">
                    <div className="h-8 w-1 rounded-full bg-gradient-to-b from-primary-500 to-secondary-500" />
                    <h2 className="text-xl font-bold text-ink font-display">
                      {expandedStation.name}
                    </h2>
                    <span className="text-xs text-muted font-mono">
                      ({expandedStation.lat.toFixed(2)}, {expandedStation.lng.toFixed(2)})
                    </span>
                  </div>
                  <button
                    onClick={() => setExpandedStation(null)}
                    className="flex items-center justify-center size-9 rounded-full hover:bg-[var(--canvas-strong)] text-muted transition-colors"
                  >
                    <span className="material-symbols-outlined">close</span>
                  </button>
                </div>

                {/* Vertical multilingual layout - full width */}
                <div className="flex flex-col gap-4">
                  {languages.map((lang) => {
                    const labels = LABELS[lang.lang];
                    return (
                      <div
                        key={lang.lang}
                        className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] overflow-hidden"
                      >
                        {/* Language header */}
                        <div
                          className={`bg-gradient-to-r ${lang.color} px-4 py-2.5 flex items-center gap-2`}
                        >
                          <span className="material-symbols-outlined text-white text-lg">
                            {lang.flag}
                          </span>
                          <h3 className="text-sm font-bold text-white">{lang.lang}</h3>
                        </div>

                        <div className="p-4 space-y-3">
                          {/* Station-level interpretation */}
                          <div className="rounded-xl bg-gradient-to-r from-primary-900/5 to-secondary-900/5 dark:from-primary-400/5 dark:to-secondary-400/5 border border-primary-200/30 dark:border-primary-700/20 p-3">
                            <p className="text-xs uppercase tracking-widest text-ink/60 font-semibold mb-2 flex items-center gap-1">
                              <span className="material-symbols-outlined text-xs">location_on</span>
                              {labels.interp_station}
                            </p>
                            <p className="text-sm text-ink leading-relaxed">
                              {lang.stationText || (
                                <span className="text-muted italic">{labels.no_interp}</span>
                              )}
                            </p>
                          </div>

                          {/* Bulletin-level interpretation */}
                          <div className="rounded-xl bg-gradient-to-r from-secondary-900/5 to-primary-900/5 dark:from-secondary-400/5 dark:to-primary-400/5 border border-secondary-200/30 dark:border-secondary-700/20 p-3">
                            <p className="text-xs uppercase tracking-widest text-ink/60 font-semibold mb-2 flex items-center gap-1">
                              <span className="material-symbols-outlined text-xs">article</span>
                              {labels.interp_bulletin}
                            </p>
                            <p className="text-sm text-ink leading-relaxed">
                              {lang.bulletinText || (
                                <span className="text-muted italic">{labels.no_interp}</span>
                              )}
                            </p>
                          </div>

                          {/* Action buttons - Share & Voice */}
                          <div className="flex items-center justify-end gap-2 pt-2">
                            <button
                              type="button"
                              onClick={() => {
                                const text = `${lang.stationText || ""}\n\n${lang.bulletinText || ""}`;
                                if (navigator.share) {
                                  navigator.share({
                                    title: `Bulletin Meteo - ${lang.lang}`,
                                    text: text,
                                  });
                                } else {
                                  navigator.clipboard.writeText(text);
                                }
                              }}
                              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[var(--canvas-strong)] hover:bg-[var(--border)] text-muted hover:text-ink transition-all text-xs font-medium"
                              title="Partager"
                            >
                              <span className="material-symbols-outlined text-base">share</span>
                              <span className="hidden sm:inline">Partager</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                const text = `${lang.stationText || ""} ${lang.bulletinText || ""}`;
                                if (text.trim() && "speechSynthesis" in window) {
                                  window.speechSynthesis.cancel();
                                  const utterance = new SpeechSynthesisUtterance(text);
                                  utterance.lang = lang.lang === "Francais" ? "fr-FR" : "fr-FR";
                                  utterance.rate = 0.9;
                                  window.speechSynthesis.speak(utterance);
                                }
                              }}
                              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[var(--canvas-strong)] hover:bg-[var(--border)] text-muted hover:text-ink transition-all text-xs font-medium"
                              title="Ecouter"
                            >
                              <span className="material-symbols-outlined text-base">volume_up</span>
                              <span className="hidden sm:inline">Ecouter</span>
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            );
          })()}
      </div>
    </Layout>
  );
}
