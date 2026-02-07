import { useEffect, useState } from "react";
import { fetchBulletins, fetchBulletinByDate, type BulletinDetail } from "../services/api";

interface StationCardProps {
  name: string;
  tmin_obs: number | null;
  tmax_obs: number | null;
  tmin_prev: number | null;
  tmax_prev: number | null;
  weather_obs: string | null;
  weather_prev: string | null;
}

function StationCard({ 
  name, 
  tmin_obs, 
  tmax_obs, 
  tmin_prev, 
  tmax_prev, 
  weather_obs, 
  weather_prev 
}: StationCardProps) {
  return (
    <div className="flex-shrink-0 w-72 rounded-2xl border border-[var(--border)] bg-[var(--surface)]/70 p-4 hover:shadow-lg transition-all duration-300">
      <div className="mb-3">
        <h3 className="font-semibold text-ink truncate">{name}</h3>
        <p className="text-xs text-muted">Station météorologique</p>
      </div>
      
      <div className="grid grid-cols-2 gap-3">
        {/* Observation */}
        <div className="rounded-xl bg-blue-50/30 border border-blue-100 p-3">
          <div className="flex items-center gap-2 mb-2">
            <span className="material-symbols-outlined text-blue-600 text-sm">visibility</span>
            <span className="text-xs font-semibold text-blue-700">Observation</span>
          </div>
          <div className="space-y-1">
            <p className="text-sm font-mono">
              <span className="text-muted">Min:</span> {tmin_obs !== null ? `${tmin_obs}°C` : "--"}
            </p>
            <p className="text-sm font-mono">
              <span className="text-muted">Max:</span> {tmax_obs !== null ? `${tmax_obs}°C` : "--"}
            </p>
            {weather_obs && (
              <p className="text-xs text-muted truncate mt-1">{weather_obs}</p>
            )}
          </div>
        </div>
        
        {/* Prévision */}
        <div className="rounded-xl bg-emerald-50/30 border border-emerald-100 p-3">
          <div className="flex items-center gap-2 mb-2">
            <span className="material-symbols-outlined text-emerald-600 text-sm">schedule</span>
            <span className="text-xs font-semibold text-emerald-700">Prévision</span>
          </div>
          <div className="space-y-1">
            <p className="text-sm font-mono">
              <span className="text-muted">Min:</span> {tmin_prev !== null ? `${tmin_prev}°C` : "--"}
            </p>
            <p className="text-sm font-mono">
              <span className="text-muted">Max:</span> {tmax_prev !== null ? `${tmax_prev}°C` : "--"}
            </p>
            {weather_prev && (
              <p className="text-xs text-muted truncate mt-1">{weather_prev}</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export function LastBulletinStations() {
  const [bulletin, setBulletin] = useState<BulletinDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const loadLastBulletin = async () => {
      try {
        setLoading(true);
        setError(null);
        
        // Récupérer la liste des bulletins pour trouver le plus récent
        const bulletinsResponse = await fetchBulletins({ limit: 10 });
        const bulletins = Array.isArray(bulletinsResponse.bulletins) ? bulletinsResponse.bulletins : [];
        
        if (bulletins.length === 0) {
          setError("Aucun bulletin disponible");
          return;
        }
        
        // Trouver la date la plus récente
        const latestDate = bulletins
          .map(b => b.date)
          .sort((a, b) => (a > b ? -1 : 1))[0];
        
        // Charger les détails du dernier bulletin (priorité aux prévisions)
        // Fallback automatique sur "observation" si la prévision n'existe pas.
        const bulletinDetail = await fetchBulletinByDate(latestDate, "forecast").catch(
          async (err) => {
            const status = (err as { status?: number })?.status;
            if (status === 404) {
              return await fetchBulletinByDate(latestDate);
            }
            throw err;
          },
        );
        setBulletin(bulletinDetail);
        
      } catch (err) {
        console.error("Erreur lors du chargement du dernier bulletin:", err);
        setError("Impossible de charger le dernier bulletin");
      } finally {
        setLoading(false);
      }
    };

    loadLastBulletin();
  }, []);

  if (loading) {
    return (
      <div className="rounded-3xl bg-gradient-to-br from-primary-900 via-primary-800 to-secondary-700 p-6 shadow-2xl shadow-primary-900/30 relative overflow-hidden">
        <div className="absolute top-0 right-0 w-40 h-40 bg-primary-400/15 rounded-full blur-2xl translate-x-10 -translate-y-10" />
        <div className="absolute bottom-0 left-0 w-32 h-32 bg-sky-400/10 rounded-full blur-2xl -translate-x-8 translate-y-8" />
        
        <div className="relative z-10 space-y-5">
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center rounded-xl bg-white/10 size-10 animate-pulse">
              <span className="material-symbols-outlined text-sky-300 text-xl">description</span>
            </div>
            <div>
              <div className="h-4 bg-white/20 rounded w-32 mb-2 animate-pulse"></div>
              <div className="h-3 bg-white/10 rounded w-24 animate-pulse"></div>
            </div>
          </div>
          
          <div className="h-20 bg-white/10 rounded-2xl animate-pulse"></div>
        </div>
      </div>
    );
  }

  if (error || !bulletin) {
    return (
      <div className="rounded-3xl bg-gradient-to-br from-primary-900 via-primary-800 to-secondary-700 p-6 shadow-2xl shadow-primary-900/30 relative overflow-hidden">
        <div className="absolute top-0 right-0 w-40 h-40 bg-primary-400/15 rounded-full blur-2xl translate-x-10 -translate-y-10" />
        <div className="absolute bottom-0 left-0 w-32 h-32 bg-sky-400/10 rounded-full blur-2xl -translate-x-8 translate-y-8" />
        
        <div className="relative z-10 flex items-center justify-center h-32">
          <p className="text-white/70 text-center">
            {error || "Aucun bulletin disponible"}
          </p>
        </div>
      </div>
    );
  }

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString("fr-FR", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric"
    });
  };

  return (
    <div className="rounded-3xl bg-gradient-to-br from-primary-900 via-primary-800 to-secondary-700 p-6 shadow-2xl shadow-primary-900/30 relative overflow-hidden">
      <div className="absolute top-0 right-0 w-40 h-40 bg-primary-400/15 rounded-full blur-2xl translate-x-10 -translate-y-10" />
      <div className="absolute bottom-0 left-0 w-32 h-32 bg-sky-400/10 rounded-full blur-2xl -translate-x-8 translate-y-8" />
      
      <div className="relative z-10">
        {/* Header */}
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center rounded-xl bg-white/10 size-10">
              <span className="material-symbols-outlined text-sky-300 text-xl">description</span>
            </div>
            <div>
              <p className="text-sm font-semibold text-white">Dernier bulletin traité</p>
              <p className="text-xs text-blue-200/60">{formatDate(bulletin.date_bulletin)}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium bg-emerald-100/20 text-emerald-300 border border-emerald-300/30">
              {bulletin.type === "forecast" ? "Prévision" : "Observation"}
            </span>
          </div>
        </div>
        
        {/* Stations scrollable */}
        <div className="relative">
          <div className="overflow-x-auto pb-2 -mx-2 px-2 scrollbar-thin scrollbar-thumb-white/20 scrollbar-track-transparent">
            <div className="flex gap-4 min-w-max pr-4">
              {bulletin.stations && bulletin.stations.length > 0 ? (
                bulletin.stations.map((station, index) => (
                  <StationCard
                    key={`${station.name || 'station'}-${index}`}
                    name={station.name || `Station ${index + 1}`}
                    tmin_obs={station.tmin_obs ?? null}
                    tmax_obs={station.tmax_obs ?? null}
                    tmin_prev={station.tmin_prev ?? null}
                    tmax_prev={station.tmax_prev ?? null}
                    weather_obs={station.weather_obs ?? null}
                    weather_prev={station.weather_prev ?? null}
                  />
                ))
              ) : (
                <div className="flex-shrink-0 w-72 flex items-center justify-center h-40 rounded-2xl border border-white/10 bg-white/5">
                  <p className="text-white/50 text-center text-sm">
                    Aucune station disponible
                  </p>
                </div>
              )}
            </div>
          </div>
          
          {/* Scroll indicators */}
          {bulletin.stations && bulletin.stations.length > 2 && (
            <>
              <div className="absolute left-0 top-0 bottom-0 w-8 bg-gradient-to-r from-primary-800 to-transparent pointer-events-none z-10" />
              <div className="absolute right-0 top-0 bottom-0 w-8 bg-gradient-to-l from-primary-800 to-transparent pointer-events-none z-10" />
            </>
          )}
        </div>
        
        {/* Footer stats */}
        {bulletin.stations && bulletin.stations.length > 0 && (
          <div className="mt-4 pt-3 border-t border-white/10">
            <div className="flex items-center justify-between text-xs">
              <span className="text-blue-200/60">
                {bulletin.stations.length} station{bulletin.stations.length > 1 ? 's' : ''}
              </span>
              <div className="flex items-center gap-3">
                {bulletin.interpretation_francais && (
                  <span className="inline-flex items-center gap-1 text-blue-200/60">
                    <span className="material-symbols-outlined text-xs">translate</span>
                    FR
                  </span>
                )}
                {bulletin.interpretation_moore && (
                  <span className="inline-flex items-center gap-1 text-blue-200/60">
                    <span className="material-symbols-outlined text-xs">translate</span>
                    MO
                  </span>
                )}
                {bulletin.interpretation_dioula && (
                  <span className="inline-flex items-center gap-1 text-blue-200/60">
                    <span className="material-symbols-outlined text-xs">translate</span>
                    DI
                  </span>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
