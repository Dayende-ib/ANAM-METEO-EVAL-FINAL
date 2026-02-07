import { useEffect, useState } from "react";
import { BrowserRouter, Route, Routes, Navigate, Outlet } from "react-router-dom";
import { DashboardPage } from "./pages/DashboardPage";
import { HomePage } from "./pages/HomePage";
import { LoginPage } from "./pages/LoginPage";
import { AboutPage } from "./pages/AboutPage";
import { MapPage } from "./pages/MapPage";
import { ExplorationBulletinsPage } from "./pages/ExplorationBulletinsPage";

import { UnifiedMetricsPage } from "./pages/UnifiedMetricsPage";
import { PilotagePipelinePage } from "./pages/PilotagePipelinePage";
import { UploadBulletinPage } from "./pages/UploadBulletinPage";
import { ValidationIssuesPage } from "./pages/ValidationIssuesPage";
import { NotFoundPage } from "./pages/NotFoundPage";
import { ParametresPage } from "./pages/ParametresPage";
import { DetailsStationsPage } from "./pages/DetailsStationsPage";
import { BackgroundTasksNotifier } from "./components/BackgroundTasksNotifier";
import { StationDataPage } from "./pages/StationDataPage";
import { fetchAuthMe, getAuthToken, setAuthToken } from "./services/api";

function RequireAuth() {
 const [status, setStatus] = useState<"checking" | "authed" | "unauth">("checking");

 useEffect(() => {
  let cancelled = false;
  const checkAuth = async () => {
   const token = getAuthToken();
   if (!token) {
    setStatus("unauth");
    return;
   }
   try {
    await fetchAuthMe();
    if (cancelled) return;
    setStatus("authed");
   } catch (err) {
    if (cancelled) return;
    const statusCode = (err as { status?: number })?.status;
    if (statusCode === 401 || statusCode === 403) {
     setAuthToken(null);
     setStatus("unauth");
     return;
    }
    setStatus("authed");
   }
  };
  checkAuth();
  return () => {
   cancelled = true;
  };
 }, []);

 if (status === "checking") {
  return (
   <div className="flex min-h-screen items-center justify-center bg-canvas text-ink">
    <div className="surface-panel p-6 text-sm text-muted">Verification de la session...</div>
   </div>
  );
 }

 if (status === "unauth") {
  return <Navigate to="/login" replace />;
 }

 return <Outlet />;
}

export default function App() {
 return (
  <BrowserRouter>
   <div className="flex h-screen flex-col overflow-hidden bg-canvas text-ink font-body antialiased ">
    <Routes>
     <Route path="/" element={<HomePage />} />
     <Route path="/login" element={<LoginPage />} />
     <Route element={<RequireAuth />}>
      <Route path="/dashboard" element={<DashboardPage />} />
      <Route path="/exploration-bulletins" element={<ExplorationBulletinsPage />} />
      <Route path="/metriques-unifiees" element={<UnifiedMetricsPage />} />
      <Route path="/pilotage-pipeline" element={<PilotagePipelinePage />} />
      <Route path="/upload" element={<UploadBulletinPage />} />
      <Route path="/map" element={<MapPage />} />
      <Route path="/details-stations" element={<DetailsStationsPage />} />
      <Route path="/donnees-stations" element={<StationDataPage />} />
      <Route path="/validation-issues" element={<ValidationIssuesPage />} />
      <Route path="/parametres" element={<ParametresPage />} />
      <Route path="/about" element={<AboutPage />} />
     </Route>
     <Route path="*" element={<NotFoundPage />} />
    </Routes>

    {/* Notification flottante des tâches en arrière-plan (visible sur toutes les pages) */}
    <BackgroundTasksNotifier />
   </div>
  </BrowserRouter>
 );
}
