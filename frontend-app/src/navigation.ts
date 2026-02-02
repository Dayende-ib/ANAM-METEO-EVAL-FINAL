export type NavItem = {
  label: string;
  to: string;
  icon: string;
};

export const NAV_ITEMS: NavItem[] = [
  { label: "Tableau de bord", to: "/dashboard", icon: "dashboard" },
  { label: "Exploration des bulletins", to: "/exploration-bulletins", icon: "description" },
  { label: "Métriques d'évaluation", to: "/metriques-evaluation", icon: "assessment" },
  { label: "Pilotage du pipeline", to: "/pilotage-pipeline", icon: "settings" },
  { label: "Téléchargement", to: "/upload", icon: "cloud_upload" },
  { label: "Carte", to: "/map", icon: "public" },
  { label: "Anomalies validation", to: "/validation-issues", icon: "report" },
  { label: "Paramètres", to: "/parametres", icon: "tune" },
  { label: "À propos", to: "/about", icon: "info" },
];
