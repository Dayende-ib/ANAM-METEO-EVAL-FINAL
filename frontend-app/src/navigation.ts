export type NavItem = {
  label: string;
  to: string;
  icon: string;
};

export const NAV_ITEMS: NavItem[] = [
  { label: "Tableau de bord", to: "/dashboard", icon: "dashboard" },
  { label: "Feed bulletin du jour", to: "/feed-bulletin-jour", icon: "feed" },
  { label: "Exploration des bulletins", to: "/exploration-bulletins", icon: "description" },
  { label: "Metriques unifiees", to: "/metriques-unifiees", icon: "analytics" },
  { label: "Pilotage du pipeline", to: "/pilotage-pipeline", icon: "settings" },
  { label: "Telechargement", to: "/upload", icon: "cloud_upload" },
  // { label: "Carte", to: "/map", icon: "public" },
  { label: "Details stations", to: "/details-stations", icon: "thermostat" },
  { label: "Donnees stations", to: "/donnees-stations", icon: "table_chart" },
  { label: "Anomalies validation", to: "/validation-issues", icon: "report" },
  { label: "Parametres", to: "/parametres", icon: "tune" },
  { label: "A propos", to: "/about", icon: "info" },
];

export const ADMIN_NAV_ITEM: NavItem = {
  label: "Utilisateurs",
  to: "/admin-utilisateurs",
  icon: "admin_panel_settings",
};
