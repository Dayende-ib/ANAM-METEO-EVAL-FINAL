import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { fetchBulletins, type BulletinSummary } from "../services/api";
import logoANAM from "../assets/logoANAMoriginal.png";

const THEME_KEY = "anam-theme";

const getStoredTheme = () => {
  const stored = window.localStorage.getItem(THEME_KEY);
  if (stored === "dark" || stored === "light") return stored;
  return null;
};

const getInitialTheme = () => {
  const stored = getStoredTheme();
  if (stored === "dark") return true;
  if (stored === "light") return false;
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;
};

const FEATURES = [
  {
    icon: "dashboard",
    title: "Tableau de bord",
    description: "Vue d'ensemble des métriques de qualité de prévision avec graphiques et matrice de confusion",
    to: "/dashboard",
    gradient: "from-primary-500 to-primary-700",
  },
  {
    icon: "description",
    title: "Bulletins Météo",
    description: "Explorer et analyser les bulletins météorologiques avec support multilingue (Français, Mooré, Dioula)",
    to: "/exploration-bulletins",
    gradient: "from-secondary-400 to-secondary-700",
  },
  {
    icon: "assessment",
    title: "Métriques d'évaluation",
    description: "Analyse mensuelle détaillée des performances de prévision (MAE, RMSE, Biais, Accuracy)",
    to: "/metriques-evaluation",
    gradient: "from-sky-400 to-blue-600",
  },
  {
    icon: "settings",
    title: "Pilotage du Pipeline",
    description: "Orchestration et monitoring du pipeline de traitement : scraping, OCR, classification, intégration",
    to: "/pilotage-pipeline",
    gradient: "from-indigo-400 to-indigo-700",
  },
  {
    icon: "cloud_upload",
    title: "Téléchargement",
    description: "Upload de bulletins PDF avec détection OCR automatique des valeurs de température",
    to: "/upload",
    gradient: "from-cyan-400 to-cyan-700",
  },
  {
    icon: "public",
    title: "Informations détaillées sur les stations",
    description: "Visualisation géographique des stations météo du Burkina Faso sur carte interactive",
    to: "/map",
    gradient: "from-blue-400 to-indigo-600",
  },
];

const PIPELINE_STEPS = [
  { icon: "download", label: "Scraping", desc: "Collecte automatique" },
  { icon: "document_scanner", label: "OCR", desc: "Extraction de texte" },
  { icon: "category", label: "Classification", desc: "Catégorisation" },
  { icon: "integration_instructions", label: "Intégration", desc: "Base de données" },
  { icon: "analytics", label: "Évaluation", desc: "Métriques qualité" },
  { icon: "translate", label: "Interprétation", desc: "Multilingue" },
];

export function HomePage() {
  const navigate = useNavigate();
  const [isDarkMode, setIsDarkMode] = useState(getInitialTheme);
  const [isThemeLocked, setIsThemeLocked] = useState(() => getStoredTheme() !== null);
  const [bulletinCount, setBulletinCount] = useState<number>(0);
  const [dateCount, setDateCount] = useState<number>(0);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", isDarkMode);
    if (isThemeLocked) {
      window.localStorage.setItem(THEME_KEY, isDarkMode ? "dark" : "light");
    }
  }, [isDarkMode, isThemeLocked]);

  useEffect(() => {
    const loadStats = async () => {
      try {
        const payload = await fetchBulletins();
        const items = Array.isArray(payload.bulletins) ? payload.bulletins : [];
        setBulletinCount(items.length);
        const dates = new Set(items.map((b: BulletinSummary) => b.date).filter(Boolean));
        setDateCount(dates.size);
      } catch {
        // silent
      }
    };
    loadStats();
  }, []);

  return (
    <div className="h-screen overflow-y-auto bg-[var(--canvas)]">
      {/* ===== HEADER / NAV ===== */}
      <header className="sticky top-0 z-30 border-b border-[var(--border)] bg-[var(--surface)]/80 backdrop-blur-lg">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
          <div className="flex items-center">
            <img src={logoANAM} alt="ANAM Logo" className="h-12 object-contain" />
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => {
                setIsThemeLocked(true);
                setIsDarkMode((prev) => !prev);
              }}
              className="flex h-9 w-9 items-center justify-center rounded-full bg-[var(--canvas-strong)] text-ink hover:bg-[var(--border)] transition-colors"
              aria-label="Basculer le thème"
            >
              <span className="material-symbols-outlined text-lg">
                {isDarkMode ? "light_mode" : "dark_mode"}
              </span>
            </button>
            <button
              onClick={() => navigate("/login")}
              className="hidden sm:inline-flex rounded-full bg-gradient-to-r from-primary-500 to-primary-600 px-5 py-2 text-sm font-semibold text-white shadow-lg shadow-primary-500/25 hover:from-primary-600 hover:to-primary-700 transition-all"
            >
              Connexion
            </button>
          </div>
        </div>
      </header>

      {/* ===== HERO ===== */}
      <section className="relative overflow-hidden">
        {/* Background decorations */}
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div className="absolute top-20 left-[10%] w-[500px] h-[500px] rounded-full bg-primary-500/[0.07] blur-3xl" />
          <div className="absolute top-40 right-[5%] w-[400px] h-[400px] rounded-full bg-secondary-400/[0.06] blur-3xl" />
          <div className="absolute -bottom-20 left-[40%] w-[350px] h-[350px] rounded-full bg-sky-400/[0.05] blur-3xl" />
        </div>

        <div className="relative mx-auto max-w-6xl px-6 pt-20 pb-16 md:pt-28 md:pb-24">
          <div className="flex flex-col lg:flex-row lg:items-center lg:gap-16">
            {/* Left - Text */}
            <div className="flex-1 space-y-6 animate-rise">
              <div className="inline-flex items-center gap-2 rounded-full border border-primary-200 dark:border-primary-800/40 bg-primary-50 dark:bg-primary-900/20 px-4 py-1.5">
                <span className="h-2 w-2 rounded-full bg-primary-500 pulse-soft" />
                <span className="text-xs font-medium text-primary-700 dark:text-primary-300 uppercase tracking-wider">
                  Hackathon MTDPCE 2025
                </span>
              </div>

              <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold text-ink font-display leading-[1.1]">
                Évaluation des
                <br />
                <span className="bg-gradient-to-r from-primary-500 via-secondary-500 to-sky-400 bg-clip-text text-transparent">
                  prévisions météo
                </span>
                <br />
                du Burkina Faso
              </h1>

              <p className="text-lg text-muted max-w-xl leading-relaxed">
                Plateforme de contrôle qualité pour les modèles de prévision météorologique. Suivi
                en temps réel, évaluation des performances et traduction multilingue des bulletins.
              </p>

              <div className="flex flex-wrap items-center gap-4 pt-2">
                <button
                  onClick={() => navigate("/dashboard")}
                  className="group inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-primary-500 to-primary-600 px-7 py-3 text-base font-semibold text-white shadow-xl shadow-primary-500/30 hover:shadow-primary-500/40 hover:from-primary-600 hover:to-primary-700 transition-all duration-200"
                >
                  Accéder au tableau de bord
                  <span className="material-symbols-outlined text-lg group-hover:translate-x-0.5 transition-transform">
                    arrow_forward
                  </span>
                </button>
                <button
                  onClick={() => navigate("/about")}
                  className="inline-flex items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--surface)] px-7 py-3 text-base font-semibold text-ink hover:bg-[var(--canvas-strong)] transition-colors"
                >
                  En savoir plus
                </button>
              </div>
            </div>

            {/* Right - Stats Preview */}
            <div
              className="mt-12 lg:mt-0 lg:w-[380px] flex-shrink-0 animate-rise"
              style={{ animationDelay: "150ms" }}
            >
              <div className="rounded-3xl bg-gradient-to-br from-primary-900 via-primary-800 to-secondary-700 p-6 shadow-2xl shadow-primary-900/30 relative overflow-hidden">
                <div className="absolute top-0 right-0 w-40 h-40 bg-primary-400/15 rounded-full blur-2xl translate-x-10 -translate-y-10" />
                <div className="absolute bottom-0 left-0 w-32 h-32 bg-sky-400/10 rounded-full blur-2xl -translate-x-8 translate-y-8" />

                <div className="relative z-10 space-y-5">
                  <div className="flex items-center gap-3">
                    <div className="flex items-center justify-center rounded-xl bg-white/10 size-10">
                      <span className="material-symbols-outlined text-sky-300 text-xl">
                        insights
                      </span>
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-white">Aperçu système</p>
                      <p className="text-xs text-blue-200/60">Données en temps réel</p>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="rounded-2xl bg-white/10 backdrop-blur-sm border border-white/[0.08] p-4">
                      <p className="text-xs text-blue-200/60 uppercase tracking-wider mb-1">
                        Bulletins
                      </p>
                      <p className="text-3xl font-bold font-mono text-white">{bulletinCount}</p>
                    </div>
                    <div className="rounded-2xl bg-white/10 backdrop-blur-sm border border-white/[0.08] p-4">
                      <p className="text-xs text-blue-200/60 uppercase tracking-wider mb-1">
                        Dates
                      </p>
                      <p className="text-3xl font-bold font-mono text-white">{dateCount}</p>
                    </div>
                  </div>

                  <div className="space-y-2">
                    {[
                      { label: "Précision de l'extraction", value: 94 },
                      { label: "Couverture stations", value: 78 },
                    ].map((stat) => (
                      <div key={stat.label}>
                        <div className="flex items-center justify-between text-xs mb-1">
                          <span className="text-blue-100/70">{stat.label}</span>
                          <span className="font-mono text-white font-semibold">{stat.value}%</span>
                        </div>
                        <div className="h-1.5 rounded-full bg-white/10 overflow-hidden">
                          <div
                            className="h-full rounded-full bg-gradient-to-r from-sky-400 to-primary-400 transition-all duration-1000"
                            style={{ width: `${stat.value}%` }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ===== PIPELINE OVERVIEW ===== */}
      <section className="border-t border-[var(--border)] bg-[var(--surface)]/50 backdrop-blur-sm">
        <div className="mx-auto max-w-6xl px-6 py-12">
          <div className="text-center mb-10 animate-rise">
            <h2 className="text-2xl font-bold text-ink font-display">Pipeline de traitement</h2>
            <p className="text-sm text-muted mt-2">
              Du scraping à l'interprétation multilingue, en 6 étapes automatisées
            </p>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
            {PIPELINE_STEPS.map((step, index) => (
              <div
                key={step.label}
                className="group relative flex flex-col items-center text-center p-4 rounded-2xl border border-[var(--border)] bg-[var(--surface)] hover:border-primary-300 dark:hover:border-primary-700 hover:shadow-lg hover:shadow-primary-500/5 transition-all duration-300 animate-rise"
                style={{ animationDelay: `${index * 80}ms` }}
              >
                {index < PIPELINE_STEPS.length - 1 && (
                  <div className="hidden lg:block absolute top-1/2 -right-2 w-4 h-px bg-[var(--border)] group-hover:bg-primary-300 dark:group-hover:bg-primary-700 transition-colors" />
                )}
                <div className="flex items-center justify-center rounded-xl bg-gradient-to-br from-primary-50 to-secondary-50 dark:from-primary-900/30 dark:to-secondary-700/15 size-12 mb-3 group-hover:scale-110 transition-transform duration-300">
                  <span className="material-symbols-outlined text-primary-600 dark:text-primary-400 text-xl">
                    {step.icon}
                  </span>
                </div>
                <span className="text-[10px] font-bold text-primary-500 uppercase tracking-widest mb-0.5">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <p className="text-sm font-semibold text-ink">{step.label}</p>
                <p className="text-[11px] text-muted mt-0.5">{step.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ===== FEATURES GRID ===== */}
      <section className="mx-auto max-w-6xl px-6 py-16">
        <div className="text-center mb-10 animate-rise">
          <h2 className="text-2xl font-bold text-ink font-display">Modules de la plateforme</h2>
          <p className="text-sm text-muted mt-2">
            Accédez à toutes les fonctionnalités depuis un seul endroit
          </p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {FEATURES.map((feature, index) => (
            <button
              key={feature.to}
              onClick={() => navigate(feature.to)}
              className="group surface-panel soft p-6 text-left transition-all duration-300 hover:-translate-y-1.5 hover:shadow-xl animate-rise"
              style={{ animationDelay: `${index * 70}ms` }}
            >
              <div
                className={`inline-flex rounded-2xl bg-gradient-to-br ${feature.gradient} p-3.5 mb-5 shadow-lg group-hover:scale-110 group-hover:shadow-xl transition-all duration-300`}
              >
                <span className="material-symbols-outlined text-white text-2xl">
                  {feature.icon}
                </span>
              </div>
              <h3 className="text-lg font-semibold text-ink font-display mb-2">{feature.title}</h3>
              <p className="text-sm text-muted leading-relaxed">{feature.description}</p>
              <div className="flex items-center gap-1.5 mt-4 text-sm font-medium text-primary-500 dark:text-primary-400 opacity-0 group-hover:opacity-100 translate-x-0 group-hover:translate-x-1 transition-all duration-300">
                <span>Accéder</span>
                <span className="material-symbols-outlined text-base">arrow_forward</span>
              </div>
            </button>
          ))}
        </div>
      </section>

      {/* ===== TEAM & CTA ===== */}
      <section className="border-t border-[var(--border)]">
        <div className="mx-auto max-w-6xl px-6 py-16">
          <div className="rounded-3xl bg-gradient-to-br from-primary-900 via-primary-800 to-secondary-700 p-10 md:p-14 relative overflow-hidden">
            <div className="absolute top-0 right-0 w-80 h-80 bg-primary-400/10 rounded-full blur-3xl translate-x-20 -translate-y-20" />
            <div className="absolute bottom-0 left-0 w-60 h-60 bg-sky-400/10 rounded-full blur-3xl -translate-x-16 translate-y-16" />

            <div className="relative z-10 flex flex-col md:flex-row md:items-center md:justify-between gap-8">
              <div className="space-y-4 max-w-lg">
                <h2 className="text-3xl font-bold text-white font-display">
                  Prêt à explorer les données météo ?
                </h2>
                <p className="text-blue-100/70 leading-relaxed">
                  Développé par l'équipe du Hackathon MTDPCE 2025 pour l'Agence Nationale de la
                  Météorologie du Burkina Faso.
                </p>
                <div className="flex items-center gap-4 pt-2">
                  <div className="flex -space-x-2">
                    {["D", "I", "P", "O", "B", "K"].map((initial, i) => (
                      <div
                        key={initial}
                        className="flex items-center justify-center rounded-full size-10 border-2 border-primary-800 text-sm font-bold text-white"
                        style={{
                          background: [
                            "linear-gradient(135deg, #0A9AFF, #3B82F6)",
                            "linear-gradient(135deg, #38BDF8, #0EA5E9)",
                            "linear-gradient(135deg, #60A5FA, #6366F1)",
                            "linear-gradient(135deg, #0A9AFF, #3B82F6)",
                            "linear-gradient(135deg, #38BDF8, #0EA5E9)",
                            "linear-gradient(135deg, #60A5FA, #6366F1)",
                          ][i],
                        }}
                      >
                        {initial}
                      </div>
                    ))}
                  </div>
                  <p className="text-sm text-blue-200/60">Djeneba, Ibrahim & Patricia</p>
                </div>
              </div>
              <div className="flex flex-col gap-3">
                <button
                  onClick={() => navigate("/dashboard")}
                  className="rounded-full bg-white px-8 py-3 text-base font-semibold text-primary-900 shadow-xl hover:bg-blue-50 transition-all duration-200"
                >
                  Lancer la console
                </button>
                <button
                  onClick={() => navigate("/about")}
                  className="rounded-full border border-white/20 bg-white/10 backdrop-blur-sm px-8 py-3 text-base font-semibold text-white hover:bg-white/20 transition-all duration-200"
                >
                  À propos du projet
                </button>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ===== FOOTER ===== */}
      <footer className="border-t border-[var(--border)] bg-[var(--surface)]/60">
        <div className="mx-auto max-w-6xl px-6 py-8 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2 text-sm text-muted">
            <img src={logoANAM} alt="ANAM Logo" className="h-8 object-contain" />
            <span className="text-muted">&middot; {new Date().getFullYear()}</span>
          </div>
          <p className="text-xs text-muted">Hackathon MTDPCE 2025 &middot; Burkina Faso</p>
        </div>
      </footer>
    </div>
  );
}
