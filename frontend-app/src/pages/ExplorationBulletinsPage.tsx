import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import { Layout } from "../components/Layout";
import { ErrorPanel, LoadingPanel } from "../components/StatusPanel";
import {
  fetchBulletinByDate,
  fetchBulletins,
  fetchMetricsByDate,
  startBulletinsReprocess,
  regenerateBulletinTranslationAsync,
  getTranslationTaskStatus,
  type BulletinDetail,
  type BulletinSummary,
  type StationPayload,
  type MetricsResponse,
} from "../services/api";
import { useBackgroundTasks } from "../hooks/useBackgroundTasks";

// Types locaux
interface BulletinExtended extends BulletinSummary {
  id: string;
  stations?: StationPayload[];
  interpretation_francais?: string | null;
  interpretation_moore?: string | null;
  interpretation_dioula?: string | null;
}

type LanguageKey = "interpretation_francais" | "interpretation_moore" | "interpretation_dioula";

const LANGUAGE_OPTIONS: Array<{ key: LanguageKey; label: string; color: string }> = [
  { key: "interpretation_francais", label: "Français", color: "emerald" },
  { key: "interpretation_moore", label: "Mooré", color: "blue" },
  { key: "interpretation_dioula", label: "Dioula", color: "amber" },
];

type ViewMode = "list" | "detail";

export function ExplorationBulletinsPage() {
  // Hook des tâches en arrière-plan
  const { createBulkTranslationTask, createBulletinReprocessTask, hasActiveTasks, allTasks } = useBackgroundTasks();
  
  // États principaux
  const [bulletins, setBulletins] = useState<BulletinExtended[]>([]);
  const [selectedBulletin, setSelectedBulletin] = useState<BulletinExtended | null>(null);
  const [metrics, setMetrics] = useState<MetricsResponse | null>(null);
  
  // États de filtrage
  const [selectedDate, setSelectedDate] = useState<string>("");
  const [filterType, setFilterType] = useState<"all" | "observation" | "forecast">("all");
  const [selectedLanguages, setSelectedLanguages] = useState<LanguageKey[]>(
    LANGUAGE_OPTIONS.map((opt) => opt.key),
  );
  const [searchQuery, setSearchQuery] = useState("");
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  
  // États de chargement et erreurs
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [metricsLoading, setMetricsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  
  // États de régénération
  const [regeneratingLanguage, setRegeneratingLanguage] = useState<LanguageKey | null>(null);
  
  // Notifications toast
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" | "info" } | null>(null);

  // Rapport de rÃ©-extraction
  const [reprocessSummary, setReprocessSummary] = useState<{
    total: number;
    success: number;
    failed: number;
    skipped: number;
    missing: number;
    errors: string[];
    status: "completed" | "failed";
    errorMessage?: string;
  } | null>(null);
  const notifiedReprocessRef = useRef<Set<string>>(new Set());
  
  // Afficher un toast
  const showToast = (message: string, type: "success" | "error" | "info" = "info") => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 5000);
  };

  const refreshBulletins = useCallback(
    async (options?: { notifyMessage?: string; setDefaultDate?: boolean }) => {
      const payload = await fetchBulletins({ limit: 200 });
      const items = Array.isArray(payload.bulletins) ? payload.bulletins : [];
      const normalized = items.map((item, index) => ({
        ...item,
        id: `${item.date}-${item.type}-${index}`,
      }));
      setBulletins(normalized);
      if (normalized.length > 0 && options?.setDefaultDate) {
        const dates = Array.from(new Set(normalized.map((b) => b.date))).sort(
          (a, b) => (a > b ? -1 : 1),
        );
        setSelectedDate((current) => current || dates[0]);
      }
      if (options?.notifyMessage) {
        showToast(options.notifyMessage, "success");
      }
      setError(
        normalized.length === 0
          ? "Aucun bulletin disponible. Veuillez d'abord lancer le pipeline pour gÃ©nÃ©rer des bulletins."
          : null,
      );
      return normalized;
    },
    [],
  );

  const hasActiveReprocess = useMemo(
    () =>
      allTasks.some(
        (task) =>
          task.type === "bulletin_reprocess" &&
          (task.status === "pending" || task.status === "running"),
      ),
    [allTasks],
  );

  // Chargement initial des bulletins
  useEffect(() => {
    const loadBulletins = async () => {
      try {
        setLoading(true);
        await refreshBulletins({ setDefaultDate: true });
      } catch (err) {
        console.error("Échec du chargement des bulletins:", err);
        setError("Erreur lors du chargement des bulletins. Vérifiez que le backend est démarré.");
        setBulletins([]);
      } finally {
        setLoading(false);
      }
    };
    loadBulletins();
  }, [refreshBulletins]);

  // 🔄 Recharger les bulletins automatiquement quand une tâche se termine
  useEffect(() => {
    // Importer le store pour écouter les changements
    import("../services/backgroundTasksStore").then(({ backgroundTasksStore }) => {
      const checkAndReload = async () => {
        const allTasks = backgroundTasksStore.getAllTasks();
        const recentlyCompleted = allTasks.find(
          (t) => 
            t.status === "completed" && 
            t.type === "bulk_translation" &&
            Date.now() - t.metadata.startTime < 5000 // Terminée il y a moins de 5s
        );
        
        if (recentlyCompleted) {
          console.log("🔄 Tâche terminée détectée, rechargement des bulletins...");
          try {
            const payload = await fetchBulletins({ limit: 200 });
            const items = Array.isArray(payload.bulletins) ? payload.bulletins : [];
            const normalized = items.map((item, index) => ({
              ...item,
              id: `${item.date}-${item.type}-${index}`,
            }));
            setBulletins(normalized);
            showToast("✅ Liste des bulletins rafraîchie", "success");
          } catch (err) {
            console.error("❌ Erreur lors du rechargement automatique:", err);
          }
        }
      };

      const unsubscribe = backgroundTasksStore.subscribe(checkAndReload);
      return unsubscribe;
    });
  }, []);

  // Suivre la r??-extraction des bulletins et afficher un rapport
  useEffect(() => {
    const completedTasks = allTasks.filter(
      (task) =>
        task.type === "bulletin_reprocess" &&
        (task.status === "completed" || task.status === "failed"),
    );

    completedTasks.forEach((task) => {
      if (notifiedReprocessRef.current.has(task.id)) {
        return;
      }
      notifiedReprocessRef.current.add(task.id);

      const result = task.result ?? { successCount: 0, failedCount: 0, skippedCount: 0, missingCount: 0, details: [] };
      setReprocessSummary({
        total: task.progress.total,
        success: result.successCount ?? 0,
        failed: result.failedCount ?? 0,
        skipped: result.skippedCount ?? 0,
        missing: result.missingCount ?? 0,
        errors: (result.details ?? []) as string[],
        status: task.status === "failed" ? "failed" : "completed",
        errorMessage: task.error,
      });

      refreshBulletins({ notifyMessage: "Liste des bulletins rafraîchie après ré-extraction." });
    });
  }, [allTasks, refreshBulletins]);


  // Charger les détails d'un bulletin
  const loadBulletinDetails = useCallback(async (bulletin: BulletinExtended) => {
    try {
      setDetailLoading(true);
      setDetailError(null);
      
      // Si déjà chargé, afficher directement
      if (bulletin.stations) {
        setSelectedBulletin(bulletin);
        setViewMode("detail");
        return;
      }
      
      // ✨ CHARGEMENT DES PRÉVISIONS : Toujours demander le type "forecast"
      const detail = await fetchBulletinByDate(bulletin.date, "forecast");
      const updated: BulletinExtended = {
        ...bulletin,
        stations: detail.stations,
        interpretation_francais: detail.interpretation_francais,
        interpretation_moore: detail.interpretation_moore,
        interpretation_dioula: detail.interpretation_dioula,
      };
      
      // Mettre à jour le cache local
      setBulletins((current) =>
        current.map((entry) => (entry.id === bulletin.id ? updated : entry)),
      );
      setSelectedBulletin(updated);
      setViewMode("detail");
      
      // Charger les métriques si disponibles
      loadMetrics(bulletin.date);
    } catch (err) {
      const status = (err as { status?: number })?.status;
      if (status === 404) {
        setDetailError("Aucun bulletin disponible pour cette date.");
      } else {
        console.error("Échec du chargement du détail du bulletin:", err);
        setDetailError("Échec du chargement du détail du bulletin.");
      }
    } finally {
      setDetailLoading(false);
    }
  }, []);

  // Charger les métriques pour une date
  const loadMetrics = useCallback(async (date: string) => {
    try {
      setMetricsLoading(true);
      const metricsData = await fetchMetricsByDate(date);
      setMetrics(metricsData);
    } catch (err) {
      console.error("Métriques non disponibles pour cette date:", err);
      setMetrics(null);
    } finally {
      setMetricsLoading(false);
    }
  }, []);

  // Régénération d'une traduction spécifique (version asynchrone non-bloquante)
  const handleRegenerateLanguage = async (language: LanguageKey) => {
    if (!selectedBulletin) return;
    
    try {
      setRegeneratingLanguage(language);
      showToast(`Vérification de la traduction ${language}...`, "info");
      
      // ✨ UTILISER LES PRÉVISIONS : Spécifier le type "forecast"
      const response = await regenerateBulletinTranslationAsync({
        date: selectedBulletin.date,
        station_name: "Bulletin National",
        language,
      });
      
      // ✨ Si la traduction existe déjà, le backend retourne status="completed" immédiatement
      if (response.status === "completed") {
        showToast(`✅ Traduction ${language} déjà présente dans la BD`, "success");
        // Recharger les détails du bulletin pour afficher la traduction existante
        await loadBulletinDetails(selectedBulletin);
        setRegeneratingLanguage(null);
        return;
      }
      
      // Sinon, polling du statut toutes les 2 secondes
      const pollStatus = async () => {
        try {
          const status = await getTranslationTaskStatus(response.task_id);
          
          if (status.status === "completed") {
            showToast(`✓ Traduction ${language} terminée avec succès`, "success");
            // Recharger les détails du bulletin
            await loadBulletinDetails(selectedBulletin);
            setRegeneratingLanguage(null);
          } else if (status.status === "failed") {
            showToast(`✗ Erreur lors de la traduction ${language} : ${status.error}`, "error");
            setRegeneratingLanguage(null);
          } else if (status.status === "running") {
            // Continuer le polling
            setTimeout(pollStatus, 2000);
          } else {
            // pending ou cancelled
            setTimeout(pollStatus, 2000);
          }
        } catch (err) {
          console.error("Erreur lors de la vérification du statut:", err);
          showToast(`Erreur lors de la vérification du statut de traduction`, "error");
          setRegeneratingLanguage(null);
        }
      };
      
      // Démarrer le polling après 2 secondes
      setTimeout(pollStatus, 2000);
      
    } catch (err) {
      console.error(`Échec du lancement de la régénération (${language}):`, err);
      showToast(`✗ Erreur lors du lancement de la traduction ${language}`, "error");
      setRegeneratingLanguage(null);
    }
  };

  // Génération en masse des traductions manquantes (avec persistance)
  const handleGenerateMissing = async () => {
    const missingCount = bulletins.filter((b) => {
      return (
        (!b.interpretation_moore || !b.interpretation_dioula) &&
        (filterType === "all" || b.type === filterType) &&
        (!selectedDate || b.date === selectedDate)
      );
    }).length;

    if (missingCount === 0) {
      showToast("Aucune traduction manquante trouvée pour les filtres actuels.", "info");
      return;
    }

    if (
      !confirm(
        `Voulez-vous générer environ ${missingCount * 2} traductions manquantes (Mooré + Dioula) ?

⚠️ Les traductions s'exécuteront en arrière-plan sans bloquer l'interface.
⏱️ Temps estimé : ${Math.ceil(missingCount * 2 * 10 / 60)} minutes.

🔔 Vous pourrez naviguer librement dans l'application pendant le traitement.`,
      )
    ) {
      return;
    }

    showToast("🚀 Vérification et lancement des traductions...", "info");
    
    const languagesToGen: LanguageKey[] = ["interpretation_moore", "interpretation_dioula"];
    const bulletinsToProcess = bulletins.filter((b) => {
      return (
        (!b.interpretation_moore || !b.interpretation_dioula) &&
        (filterType === "all" || b.type === filterType) &&
        (!selectedDate || b.date === selectedDate)
      );
    });

    const apiTaskIds: string[] = [];
    let cachedCount = 0;

    // Lancer toutes les traductions en parallèle (non-bloquant)
    // ⚡ Le backend vérifie automatiquement si la traduction existe déjà
    for (const bulletin of bulletinsToProcess) {
      for (const language of languagesToGen) {
        try {
          // ✨ UTILISER LES PRÉVISIONS : Spécifier le type "forecast"
          const response = await regenerateBulletinTranslationAsync({
            date: bulletin.date,
            station_name: "Bulletin National",
            language,
          });
          
          // Si status="completed" immédiatement, c'est que la traduction existe déjà
          if (response.status === "completed") {
            cachedCount++;
            console.log(`✅ Traduction déjà présente : ${bulletin.date} (${language})`);
          } else {
            apiTaskIds.push(response.task_id);
          }
        } catch (err) {
          console.error(`Échec lancement ${bulletin.date} (${language})`, err);
        }
      }
    }

    if (apiTaskIds.length === 0) {
      showToast(
        `✅ Toutes les traductions existent déjà dans la base de données ! (${cachedCount} détectées)`,
        "success"
      );
      return;
    }

    // Créer une tâche en arrière-plan globale (persistante)
    const taskId = createBulkTranslationTask(apiTaskIds, {
      dateFilter: selectedDate || undefined,
      typeFilter: filterType !== "all" ? filterType : undefined,
      languages: ["Mooré", "Dioula"],
    });

    const message = cachedCount > 0
      ? `✅ Tâche créée ! ${apiTaskIds.length} traductions à générer, ${cachedCount} déjà présentes.`
      : `✅ Tâche créée avec succès ! ${apiTaskIds.length} traductions à générer.`;
    
    showToast(message, "success");
    console.log(`✅ Tâche en arrière-plan créée : ${taskId}`);
  };

  // Relancer la ré-extraction OCR + icônes sur tous les bulletins
  const handleReprocessBulletins = async () => {
    if (hasActiveReprocess) {
      showToast("Une ré-extraction est déjà en cours.", "info");
      return;
    }

    if (
      !confirm(
        `Voulez-vous relancer l'extraction OCR, la classification et l'intégration pour tous les bulletins ?

⚠️ Le traitement se fera en arrière-plan et peut prendre plusieurs minutes.
📊 Une barre de progression restera visible même si vous changez de page.
✅ Les bulletins manquants tenteront d'être retéléchargés si possible.`,
      )
    ) {
      return;
    }

    try {
      showToast("Lancement de la ré-extraction en arrière-plan...", "info");
      const response = await startBulletinsReprocess();
      if (response.total === 0) {
        showToast("Aucun PDF en base à ré-extraire.", "info");
        return;
      }
      createBulletinReprocessTask(response.batch_id, response.total);
      showToast("Ré-extraction lancée. Suivi dans la barre de tâches.", "success");
    } catch (err) {
      console.error("Échec du lancement de la ré-extraction:", err);
      showToast("Erreur lors du lancement de la ré-extraction.", "error");
    }
  };


  // Export JSON
  const exportToJSON = (bulletin: BulletinExtended) => {
    const dataStr = JSON.stringify(bulletin, null, 2);
    const dataBlob = new Blob([dataStr], { type: "application/json" });
    const url = URL.createObjectURL(dataBlob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `bulletin_${bulletin.date}_${bulletin.type}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  // Export CSV
  const exportToCSV = (bulletin: BulletinExtended) => {
    if (!bulletin.stations || bulletin.stations.length === 0) {
      alert("Aucune donnée de station disponible pour l'export.");
      return;
    }

    const headers = [
      "Station",
      "Latitude",
      "Longitude",
      "Tmin_obs",
      "Tmax_obs",
      "Weather_obs",
      "Tmin_prev",
      "Tmax_prev",
      "Weather_prev",
    ];

    const rows = bulletin.stations.map((station) => [
      station.name ?? "",
      station.latitude?.toString() ?? "",
      station.longitude?.toString() ?? "",
      station.tmin_obs?.toString() ?? "",
      station.tmax_obs?.toString() ?? "",
      station.weather_obs ?? "",
      station.tmin_prev?.toString() ?? "",
      station.tmax_prev?.toString() ?? "",
      station.weather_prev ?? "",
    ]);

    const csvContent = [
      `Bulletin Date,${bulletin.date}`,
      `Type,${bulletin.type}`,
      `Interpretation FR,"${(bulletin.interpretation_francais ?? "").replace(/"/g, '""')}"`,
      `Interpretation Moore,"${(bulletin.interpretation_moore ?? "").replace(/"/g, '""')}"`,
      `Interpretation Dioula,"${(bulletin.interpretation_dioula ?? "").replace(/"/g, '""')}"`,
      "",
      headers.join(","),
      ...rows.map((row) => row.join(",")),
    ].join("\n");
    
    const dataBlob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(dataBlob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `bulletin_${bulletin.date}_${bulletin.type}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  // Bulletins filtrés
  const filteredBulletins = useMemo(() => {
    return bulletins.filter((bulletin) => {
      const matchesDate = !selectedDate || bulletin.date === selectedDate;
      const matchesType = filterType === "all" || bulletin.type === filterType;
      const matchesSearch =
        !searchQuery ||
        bulletin.date.toLowerCase().includes(searchQuery.toLowerCase()) ||
        bulletin.type.toLowerCase().includes(searchQuery.toLowerCase());
      return matchesDate && matchesType && matchesSearch;
    });
  }, [bulletins, selectedDate, filterType, searchQuery]);

  // Statistiques
  const stats = useMemo(() => {
    const totalBulletins = bulletins.length;
    const totalPages = bulletins.reduce((sum, item) => sum + (item.pages ?? 0), 0);
    const obsCount = bulletins.filter((item) => item.type === "observation").length;
    const forecastCount = bulletins.filter((item) => item.type === "forecast").length;
    const uniqueDates = Array.from(new Set(bulletins.map((b) => b.date)));
    
    return {
      totalBulletins,
      totalPages,
      obsCount,
      forecastCount,
      uniqueDates: uniqueDates.length,
    };
  }, [bulletins]);

  // Basculer la sélection de langue
  const toggleLanguage = (key: LanguageKey) => {
    setSelectedLanguages((current) =>
      current.includes(key) ? current.filter((item) => item !== key) : [...current, key],
    );
  };

  // Formatage de date
  const formatDate = (dateString: string) =>
    new Date(dateString).toLocaleDateString("fr-FR", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });

  // Skeleton loader pour la liste
  const SkeletonRow = () => (
    <tr className="animate-pulse">
      <td className="px-6 py-4">
        <div className="h-4 bg-gray-200 rounded w-32"></div>
      </td>
      <td className="px-6 py-4">
        <div className="h-6 bg-gray-200 rounded-full w-24"></div>
      </td>
      <td className="px-6 py-4 text-right">
        <div className="h-4 bg-gray-200 rounded w-8 ml-auto"></div>
      </td>
      <td className="px-6 py-4">
        <div className="flex gap-1">
          <div className="h-5 w-5 bg-gray-200 rounded-full"></div>
          <div className="h-5 w-5 bg-gray-200 rounded-full"></div>
        </div>
      </td>
      <td className="px-6 py-4 text-right">
        <div className="h-8 bg-gray-200 rounded-full w-20 ml-auto"></div>
      </td>
    </tr>
  );

  if (loading) {
    return (
      <Layout title="Bulletins météorologiques">
        <div className="space-y-6">
          {/* Skeleton des filtres */}
          <section className="surface-panel soft p-6 animate-pulse">
            <div className="grid gap-6 lg:grid-cols-[2fr,1fr]">
              <div className="space-y-4">
                <div className="h-6 bg-gray-200 rounded w-48"></div>
                <div className="grid gap-4 sm:grid-cols-3">
                  <div className="h-10 bg-gray-200 rounded-2xl"></div>
                  <div className="h-10 bg-gray-200 rounded-2xl"></div>
                  <div className="h-10 bg-gray-200 rounded-2xl"></div>
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="h-20 bg-gray-200 rounded-2xl"></div>
                <div className="h-20 bg-gray-200 rounded-2xl"></div>
              </div>
            </div>
          </section>
          {/* Skeleton de la table */}
          <section className="surface-panel overflow-hidden">
            <div className="px-6 py-4 border-b border-[var(--border)]">
              <div className="h-6 bg-gray-200 rounded w-40"></div>
            </div>
            <table className="w-full">
              <tbody>
                {[1, 2, 3, 4, 5].map((i) => <SkeletonRow key={i} />)}
              </tbody>
            </table>
          </section>
        </div>
      </Layout>
    );
  }

  return (
    <Layout title="Bulletins météorologiques">
      <div className="space-y-6">
        {/* Toast notification */}
        {toast && (
          <div
            className={`fixed top-4 right-4 z-50 px-6 py-4 rounded-2xl shadow-lg border-l-4 animate-slide-in-right ${
              toast.type === "success"
                ? "bg-emerald-50 border-emerald-500 text-emerald-800"
                : toast.type === "error"
                ? "bg-red-50 border-red-500 text-red-800"
                : "bg-blue-50 border-blue-500 text-blue-800"
            }`}
            role="alert"
            aria-live="polite"
          >
            <div className="flex items-center gap-3">
              <span className="material-symbols-outlined text-2xl">
                {toast.type === "success" ? "check_circle" : toast.type === "error" ? "error" : "info"}
              </span>
              <p className="text-sm font-medium">{toast.message}</p>
              <button
                onClick={() => setToast(null)}
                className="ml-4 text-gray-500 hover:text-gray-700 transition-colors"
                aria-label="Fermer la notification"
              >
                <span className="material-symbols-outlined text-xl">close</span>
              </button>
            </div>
          </div>
        )}


        {reprocessSummary && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
            <div className="surface-panel w-full max-w-lg p-6">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-xs uppercase tracking-[0.3em] text-muted">Traitement terminé</p>
                  <h3 className="text-lg font-semibold text-ink font-display">
                    {reprocessSummary.status === "failed"
                      ? "Ré-extraction interrompue"
                      : "Ré-extraction terminée"}
                  </h3>
                </div>
                <button
                  type="button"
                  onClick={() => setReprocessSummary(null)}
                  className="text-muted hover:text-ink transition-colors"
                  aria-label="Fermer le rapport"
                >
                  <span className="material-symbols-outlined text-xl">close</span>
                </button>
              </div>

              <div className="grid gap-3 sm:grid-cols-2 mt-4">
                <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)]/70 p-3">
                  <p className="text-xs text-muted">Total</p>
                  <p className="text-lg font-semibold text-ink font-mono">{reprocessSummary.total}</p>
                </div>
                <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)]/70 p-3">
                  <p className="text-xs text-muted">Succès</p>
                  <p className="text-lg font-semibold text-emerald-700 font-mono">{reprocessSummary.success}</p>
                </div>
                <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)]/70 p-3">
                  <p className="text-xs text-muted">Échecs</p>
                  <p className="text-lg font-semibold text-red-600 font-mono">{reprocessSummary.failed}</p>
                </div>
                <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)]/70 p-3">
                  <p className="text-xs text-muted">Manquants</p>
                  <p className="text-lg font-semibold text-amber-600 font-mono">{reprocessSummary.missing}</p>
                </div>
                <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)]/70 p-3">
                  <p className="text-xs text-muted">Ignorés</p>
                  <p className="text-lg font-semibold text-slate-600 font-mono">{reprocessSummary.skipped}</p>
                </div>
              </div>

              {reprocessSummary.errorMessage && (
                <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-700">
                  {reprocessSummary.errorMessage}
                </div>
              )}

              {reprocessSummary.errors.length > 0 && (
                <div className="mt-4 rounded-xl border border-[var(--border)] bg-[var(--surface)]/70 p-3 max-h-48 overflow-y-auto">
                  <p className="text-xs uppercase tracking-[0.3em] text-muted mb-2">Détails</p>
                  <ul className="space-y-1 text-xs text-ink">
                    {reprocessSummary.errors.slice(0, 20).map((err, idx) => (
                      <li key={idx}>{err}</li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="mt-4 flex justify-end">
                <button
                  type="button"
                  onClick={() => setReprocessSummary(null)}
                  className="rounded-full bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-700 transition-colors"
                >
                  Fermer
                </button>
              </div>
            </div>
          </div>
        )}

        {error && <ErrorPanel message={error} />}

        {/* Section des filtres et statistiques */}
        <section className="surface-panel soft p-6">
          <div className="grid gap-6 lg:grid-cols-[2fr,1fr]">
            <div className="space-y-4">
              <div>
                <h3 className="text-lg font-semibold text-ink font-display">Filtres et recherche</h3>
                <p className="text-sm text-muted">Affinez par date, type et langue de bulletin.</p>
              </div>

              <div className="grid gap-4 sm:grid-cols-3">
                {/* Filtre date */}
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-[0.3em] text-muted mb-2">
                    Date
                  </label>
                  <select
                    className="w-full rounded-2xl border border-[var(--border)] bg-[var(--surface)]/70 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
                    value={selectedDate}
                    onChange={(e) => setSelectedDate(e.target.value)}
                  >
                    <option value="">Toutes les dates</option>
                    {Array.from(new Set(bulletins.map((b) => b.date)))
                      .sort((a, b) => (a > b ? -1 : 1))
                      .map((date) => (
                        <option key={date} value={date}>
                          {formatDate(date)}
                        </option>
                      ))}
                  </select>
                </div>

                {/* Filtre type */}
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-[0.3em] text-muted mb-2">
                    Type
                  </label>
                  <div className="flex items-center rounded-full border border-[var(--border)] bg-[var(--surface)]/70 p-1">
                    {[
                      { key: "all" as const, label: "Tous" },
                      { key: "observation" as const, label: "Obs" },
                      { key: "forecast" as const, label: "Prév" },
                    ].map((option) => (
                      <button
                        key={option.key}
                        type="button"
                        onClick={() => setFilterType(option.key)}
                        className={`flex-1 rounded-full px-3 py-2 text-xs font-semibold transition-all ${
                          filterType === option.key
                            ? "bg-gradient-to-br from-primary-500 to-secondary-600 text-white shadow"
                            : "text-muted hover:text-ink"
                        }`}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Recherche */}
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-[0.3em] text-muted mb-2">
                    Recherche
                  </label>
                  <input
                    type="text"
                    placeholder="Date, type..."
                    className="w-full rounded-2xl border border-[var(--border)] bg-[var(--surface)]/70 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                  />
                </div>
              </div>

              {/* Boutons d'action */}
              <div className="flex flex-wrap gap-3">
                <button
                  onClick={() => {
                    setSelectedDate("");
                    setFilterType("all");
                    setSearchQuery("");
                    setSelectedLanguages(LANGUAGE_OPTIONS.map((opt) => opt.key));
                  }}
                  className="rounded-full border border-[var(--border)] px-4 py-2 text-xs font-semibold text-ink hover:bg-[var(--canvas-strong)] transition-colors"
                >
                  Réinitialiser les filtres
                </button>
                
                {bulletins.some((b) => !b.interpretation_moore || !b.interpretation_dioula) && (
                  <button
                    type="button"
                    onClick={handleGenerateMissing}
                    disabled={hasActiveTasks}
                    className="rounded-full bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-700 disabled:bg-muted transition-colors flex items-center gap-2"
                  >
                    <span className="material-symbols-outlined text-sm">auto_fix</span>
                    Générer traductions manquantes
                  </button>
                )}

                <button
                  type="button"
                  onClick={handleReprocessBulletins}
                  disabled={hasActiveReprocess}
                  className="rounded-full border border-[var(--border)] px-4 py-2 text-xs font-semibold text-ink hover:bg-[var(--canvas-strong)] disabled:text-muted disabled:cursor-not-allowed transition-colors flex items-center gap-2"
                >
                  <span className="material-symbols-outlined text-sm">restart_alt</span>
                  {hasActiveReprocess ? "Ré-extraction en cours..." : "Relancer l'extraction"}
                </button>
              </div>
            </div>

            {/* Statistiques */}
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="group rounded-2xl border border-[var(--border)] bg-gradient-to-br from-emerald-50 to-white p-4 hover:shadow-lg transition-all duration-300 cursor-pointer">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs text-muted font-semibold uppercase tracking-wider">Bulletins</p>
                  <span className="material-symbols-outlined text-success group-hover:scale-110 transition-transform">description</span>
                </div>
                <p className="text-3xl font-bold font-mono text-ink mb-1">{stats.totalBulletins}</p>
                <div className="flex items-center gap-2">
                  <div className="h-1 flex-1 bg-tertiary rounded-full overflow-hidden">
                    <div 
                      className="h-full bg-secondary rounded-full transition-all duration-1000"
                      style={{ width: `${(filteredBulletins.length / stats.totalBulletins) * 100}%` }}
                    ></div>
                  </div>
                  <p className="text-xs text-muted whitespace-nowrap">{filteredBulletins.length} filtrés</p>
                </div>
              </div>
              <div className="group rounded-2xl border border-[var(--border)] bg-gradient-to-br from-blue-50 to-white p-4 hover:shadow-lg transition-all duration-300 cursor-pointer">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs text-muted font-semibold uppercase tracking-wider">Dates uniques</p>
                  <span className="material-symbols-outlined text-blue-600 group-hover:scale-110 transition-transform">event</span>
                </div>
                <p className="text-3xl font-bold font-mono text-ink mb-1">{stats.uniqueDates}</p>
                <p className="text-xs text-muted">📄 {stats.totalPages} pages totales</p>
              </div>
              <div className="group rounded-2xl border border-[var(--border)] bg-gradient-to-br from-sky-50 to-white p-4 hover:shadow-lg transition-all duration-300 cursor-pointer">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs text-muted font-semibold uppercase tracking-wider">Observations</p>
                  <span className="material-symbols-outlined text-sky-600 group-hover:scale-110 transition-transform">visibility</span>
                </div>
                <p className="text-3xl font-bold font-mono text-ink">{stats.obsCount}</p>
              </div>
              <div className="group rounded-2xl border border-[var(--border)] bg-gradient-to-br from-purple-50 to-white p-4 hover:shadow-lg transition-all duration-300 cursor-pointer">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs text-muted font-semibold uppercase tracking-wider">Prévisions</p>
                  <span className="material-symbols-outlined text-purple-600 group-hover:scale-110 transition-transform">schedule</span>
                </div>
                <p className="text-3xl font-bold font-mono text-ink">{stats.forecastCount}</p>
              </div>
            </div>
          </div>
        </section>

        {/* Sélecteur de langues */}
        <section className="surface-panel soft p-4">
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-xs font-semibold uppercase tracking-[0.3em] text-muted">
              Langues affichées :
            </span>
            {LANGUAGE_OPTIONS.map((option) => {
              const isSelected = selectedLanguages.includes(option.key);
              
              // Classes de style selon la langue et l'état de sélection
              let buttonClasses = "rounded-full border px-4 py-2 text-xs font-semibold transition-all ";
              
              if (isSelected) {
                if (option.color === "emerald") {
                  buttonClasses += "border-emerald-500 bg-emerald-600 text-white shadow-md";
                } else if (option.color === "blue") {
                  buttonClasses += "border-blue-500 bg-blue-600 text-white shadow-md";
                } else if (option.color === "amber") {
                  buttonClasses += "border-amber-500 bg-amber-600 text-white shadow-md";
                }
              } else {
                buttonClasses += "border-[var(--border)] text-muted hover:text-ink hover:border-gray-400";
              }
              
              return (
                <button
                  key={option.key}
                  type="button"
                  onClick={() => toggleLanguage(option.key)}
                  className={buttonClasses}
                  aria-pressed={isSelected}
                  aria-label={`${isSelected ? "Masquer" : "Afficher"} les bulletins en ${option.label}`}
                >
                  {option.label}
                </button>
              );
            })}
          </div>
        </section>

        {/* Basculer entre vue liste et détail */}
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => {
              setViewMode("list");
              setSelectedBulletin(null);
            }}
            className={`rounded-full px-4 py-2 text-sm font-semibold transition-colors flex items-center gap-2 ${
              viewMode === "list"
                ? "bg-gradient-to-br from-primary-500 to-secondary-600 text-white"
                : "border border-[var(--border)] text-ink hover:bg-[var(--canvas-strong)]"
            }`}
          >
            <span className="material-symbols-outlined text-base">list</span>
            Vue liste
          </button>
          {selectedBulletin && (
            <button
              type="button"
              onClick={() => setViewMode("detail")}
              className={`rounded-full px-4 py-2 text-sm font-semibold transition-colors flex items-center gap-2 ${
                viewMode === "detail"
                  ? "bg-emerald-600 text-white"
                  : "border border-[var(--border)] text-ink hover:bg-[var(--canvas-strong)]"
              }`}
            >
              <span className="material-symbols-outlined text-base">article</span>
              Vue détail
            </button>
          )}
        </div>

        {/* Contenu principal : Vue liste ou Vue détail */}
        {viewMode === "list" && (
          <section className="surface-panel overflow-hidden">
            <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border)] bg-[var(--canvas-strong)]">
              <div>
                <h3 className="text-lg font-semibold text-ink font-display">Liste des bulletins</h3>
                <p className="text-xs text-muted">{filteredBulletins.length} résultat(s)</p>
              </div>
              <div className="flex items-center gap-2 text-xs text-muted">
                <span className="material-symbols-outlined text-base">table_chart</span>
                Registre en direct
              </div>
            </div>
            
            <div className="max-h-[600px] overflow-x-auto overflow-y-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-[var(--surface)]/70 text-xs uppercase tracking-[0.2em] text-muted sticky top-0">
                  <tr>
                    <th className="px-6 py-3">Date</th>
                    <th className="px-6 py-3">Type</th>
                    <th className="px-6 py-3 text-right">Pages</th>
                    <th className="px-6 py-3">Traductions</th>
                    <th className="px-6 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border)]">
                  {filteredBulletins.length === 0 && (
                    <tr>
                      <td className="px-6 py-6 text-sm text-muted" colSpan={5}>
                        Aucun bulletin disponible pour les filtres actuels.
                      </td>
                    </tr>
                  )}
                  {filteredBulletins.map((bulletin) => (
                    <tr
                      key={bulletin.id}
                      className="cursor-pointer transition-colors hover:bg-[var(--canvas-strong)]"
                      onClick={() => loadBulletinDetails(bulletin)}
                    >
                      <td className="px-6 py-4 font-medium text-ink">{formatDate(bulletin.date)}</td>
                      <td className="px-6 py-4">
                        <span
                          className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold ${
                            bulletin.type === "observation"
                              ? "bg-blue-100 text-blue-700"
                              : "bg-emerald-100 text-emerald-700"
                          }`}
                        >
                          {bulletin.type === "observation" ? "Observation" : "Prévision"}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-right font-mono text-ink">{bulletin.pages}</td>
                      <td className="px-6 py-4">
                        <div className="flex gap-1">
                          {bulletin.interpretation_francais && (
                            <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-emerald-100 text-[10px] font-bold text-emerald-700">
                              FR
                            </span>
                          )}
                          {bulletin.interpretation_moore && (
                            <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-blue-100 text-[10px] font-bold text-blue-700">
                              MO
                            </span>
                          )}
                          {bulletin.interpretation_dioula && (
                            <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-amber-100 text-[10px] font-bold text-amber-700">
                              DI
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-6 py-4 text-right">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            loadBulletinDetails(bulletin);
                          }}
                          className="inline-flex items-center gap-2 rounded-full bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-700 transition-colors"
                        >
                          <span className="material-symbols-outlined text-sm">visibility</span>
                          Voir
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {/* Vue détail */}
        {viewMode === "detail" && selectedBulletin && (
          <section className="space-y-6">
            {detailLoading && (
              <LoadingPanel message="Chargement des détails du bulletin..." />
            )}
            {detailError && <ErrorPanel message={detailError} />}
            
            {!detailLoading && !detailError && (
              <>
                {/* En-tête du bulletin détaillé */}
                <div className="surface-panel p-6">
                  <div className="flex items-start justify-between mb-4">
                    <div>
                      <p className="text-xs uppercase tracking-[0.3em] text-muted">
                        {selectedBulletin.type === "observation" ? "Observation" : "Prévision"}
                      </p>
                      <h3 className="text-2xl font-bold text-ink font-display">
                        {formatDate(selectedBulletin.date)}
                      </h3>
                      <p className="text-sm text-muted mt-1">
                        {selectedBulletin.pages} page(s) • {selectedBulletin.stations?.length ?? 0} station(s)
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => exportToJSON(selectedBulletin)}
                        className="rounded-full border border-[var(--border)] px-4 py-2 text-xs font-semibold text-ink hover:bg-[var(--canvas-strong)] transition-colors flex items-center gap-2"
                      >
                        <span className="material-symbols-outlined text-sm">download</span>
                        JSON
                      </button>
                      <button
                        onClick={() => exportToCSV(selectedBulletin)}
                        className="rounded-full bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-700 transition-colors flex items-center gap-2"
                      >
                        <span className="material-symbols-outlined text-sm">table_view</span>
                        CSV
                      </button>
                    </div>
                  </div>
                </div>

                {/* Interprétations multilingues */}
                <div className="grid gap-4">
                  {LANGUAGE_OPTIONS.filter((lang) => selectedLanguages.includes(lang.key)).map(
                    (language) => {
                      const content = selectedBulletin[language.key];
                      const isGenerating = regeneratingLanguage === language.key;
                      
                      // Classes de style selon la langue
                      let panelClasses = "surface-panel p-6 border-l-4 ";
                      let headerClasses = "text-sm font-bold uppercase tracking-wider ";
                      let buttonClasses = "rounded-full border px-3 py-1 text-xs font-semibold hover:bg-opacity-10 transition-colors flex items-center gap-2 disabled:opacity-50 ";
                      
                      if (language.color === "emerald") {
                        panelClasses += "border-emerald-500";
                        headerClasses += "text-emerald-700";
                        buttonClasses += "border-emerald-500/30 bg-emerald-500/5 text-emerald-600 hover:bg-emerald-500/10";
                      } else if (language.color === "blue") {
                        panelClasses += "border-blue-500";
                        headerClasses += "text-blue-700";
                        buttonClasses += "border-blue-500/30 bg-blue-500/5 text-blue-600 hover:bg-blue-500/10";
                      } else if (language.color === "amber") {
                        panelClasses += "border-amber-500";
                        headerClasses += "text-amber-700";
                        buttonClasses += "border-amber-500/30 bg-amber-500/5 text-amber-600 hover:bg-amber-500/10";
                      }

                      return (
                        <div key={language.key} className={panelClasses}>
                          <div className="flex items-start justify-between mb-3">
                            <div>
                              <h4 className={headerClasses}>
                                {language.label}
                              </h4>
                              <p className="text-xs text-muted">Bulletin national</p>
                            </div>
                            <button
                              type="button"
                              disabled={isGenerating}
                              onClick={() => handleRegenerateLanguage(language.key)}
                              className={buttonClasses}
                              aria-label={`Régénérer la traduction en ${language.label}`}
                            >
                              {isGenerating ? (
                                <span className="material-symbols-outlined animate-spin text-sm">
                                  progress_activity
                                </span>
                              ) : (
                                <span className="material-symbols-outlined text-sm">refresh</span>
                              )}
                              Régénérer
                            </button>
                          </div>
                          <p
                            className={`text-sm leading-relaxed ${
                              content ? "text-ink whitespace-pre-wrap" : "text-muted italic"
                            }`}
                          >
                            {content || "Contenu non généré. Cliquez sur régénérer pour traduire."}
                          </p>
                        </div>
                      );
                    },
                  )}
                </div>

                {/* Métriques d'évaluation */}
                {metrics && (
                  <div className="surface-panel p-6">
                    <h4 className="text-lg font-semibold text-ink font-display mb-4">
                      Métriques d'évaluation
                    </h4>
                    <div className="grid gap-4 sm:grid-cols-4">
                      <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)]/70 p-4">
                        <p className="text-xs text-muted">MAE Tmin</p>
                        <p className="text-2xl font-semibold font-mono text-ink">
                          {metrics.mae_tmin?.toFixed(2) ?? "--"}°C
                        </p>
                      </div>
                      <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)]/70 p-4">
                        <p className="text-xs text-muted">MAE Tmax</p>
                        <p className="text-2xl font-semibold font-mono text-ink">
                          {metrics.mae_tmax?.toFixed(2) ?? "--"}°C
                        </p>
                      </div>
                      <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)]/70 p-4">
                        <p className="text-xs text-muted">RMSE Tmin</p>
                        <p className="text-2xl font-semibold font-mono text-ink">
                          {metrics.rmse_tmin?.toFixed(2) ?? "--"}°C
                        </p>
                      </div>
                      <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)]/70 p-4">
                        <p className="text-xs text-muted">RMSE Tmax</p>
                        <p className="text-2xl font-semibold font-mono text-ink">
                          {metrics.rmse_tmax?.toFixed(2) ?? "--"}°C
                        </p>
                      </div>
                      <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)]/70 p-4">
                        <p className="text-xs text-muted">Précision météo</p>
                        <p className="text-2xl font-semibold font-mono text-ink">
                          {metrics.precision_weather ? `${(metrics.precision_weather * 100).toFixed(1)}%` : "--"}
                        </p>
                      </div>
                      <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)]/70 p-4">
                        <p className="text-xs text-muted">Rappel météo</p>
                        <p className="text-2xl font-semibold font-mono text-ink">
                          {metrics.recall_weather ? `${(metrics.recall_weather * 100).toFixed(1)}%` : "--"}
                        </p>
                      </div>
                      <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)]/70 p-4">
                        <p className="text-xs text-muted">Score F1</p>
                        <p className="text-2xl font-semibold font-mono text-ink">
                          {metrics.f1_score_weather ? `${(metrics.f1_score_weather * 100).toFixed(1)}%` : "--"}
                        </p>
                      </div>
                      <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)]/70 p-4">
                        <p className="text-xs text-muted">Échantillon</p>
                        <p className="text-2xl font-semibold font-mono text-ink">
                          {metrics.sample_size ?? "--"}
                        </p>
                      </div>
                    </div>
                  </div>
                )}

                {/* Détails par station */}
                {selectedBulletin.stations && selectedBulletin.stations.length > 0 && (
                  <div className="surface-panel p-6">
                    <h4 className="text-lg font-semibold text-ink font-display mb-4 uppercase tracking-widest">
                      Détails par Station
                    </h4>
                    <div className="grid gap-4 md:grid-cols-2">
                      {selectedBulletin.stations.map((station, idx) => (
                        <div
                          key={idx}
                          className="rounded-2xl border border-[var(--border)] bg-[var(--surface)]/70 p-4 space-y-3"
                        >
                          <div className="flex items-center justify-between">
                            <div>
                              <h5 className="text-base font-semibold text-ink">
                                {station.name ?? "Station"}
                              </h5>
                              <p className="text-xs text-muted">
                                {station.latitude?.toFixed(3) ?? "--"}, {station.longitude?.toFixed(3) ?? "--"}
                              </p>
                            </div>
                            <span className="material-symbols-outlined text-muted">location_on</span>
                          </div>
                          <div className="grid gap-3 sm:grid-cols-2">
                            <div className="rounded-xl bg-blue-50/30 border border-blue-100 p-3">
                              <p className="text-xs text-blue-700 font-semibold mb-1">Observation</p>
                              <p className="text-sm font-mono text-ink">Tmin {station.tmin_obs ?? "--"}°C</p>
                              <p className="text-sm font-mono text-ink">Tmax {station.tmax_obs ?? "--"}°C</p>
                              <p className="text-xs text-muted mt-1">{station.weather_obs ?? "--"}</p>
                            </div>
                            <div className="rounded-xl bg-emerald-50/30 border border-emerald-100 p-3">
                              <p className="text-xs text-emerald-700 font-semibold mb-1">Prévision</p>
                              <p className="text-sm font-mono text-ink">Tmin {station.tmin_prev ?? "--"}°C</p>
                              <p className="text-sm font-mono text-ink">Tmax {station.tmax_prev ?? "--"}°C</p>
                              <p className="text-xs text-muted mt-1">{station.weather_prev ?? "--"}</p>
                            </div>
                          </div>
                          {typeof station.quality_score === "number" && (
                            <div className="pt-2 border-t border-[var(--border)]">
                              <p className="text-xs text-muted">
                                Score de qualité : {station.quality_score.toFixed(2)}
                              </p>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </section>
        )}
      </div>
    </Layout>
  );
}
