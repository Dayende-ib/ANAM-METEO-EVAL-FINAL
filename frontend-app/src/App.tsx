import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { DashboardPage } from "./pages/DashboardPage";
import { AboutPage } from "./pages/AboutPage";
import { MapPage } from "./pages/MapPage";
import { ExplorationBulletinsPage } from "./pages/ExplorationBulletinsPage";
import { MetriquesEvaluationPage } from "./pages/MetriquesEvaluationPage";
import { JsonMetricsPage } from "./pages/JsonMetricsPage";
import { PilotagePipelinePage } from "./pages/PilotagePipelinePage";
import { UploadBulletinPage } from "./pages/UploadBulletinPage";
import { ValidationIssuesPage } from "./pages/ValidationIssuesPage";
import { NotFoundPage } from "./pages/NotFoundPage";
import { ParametresPage } from "./pages/ParametresPage";
import { BackgroundTasksNotifier } from "./components/BackgroundTasksNotifier";

export default function App() {
 return (
  <BrowserRouter>
   <div className="flex h-screen flex-col overflow-hidden bg-canvas text-ink font-body antialiased ">
    <Routes>
     <Route path="/" element={<Navigate to="/dashboard" replace />} />
     <Route path="/dashboard" element={<DashboardPage />} />
     <Route path="/exploration-bulletins" element={<ExplorationBulletinsPage />} />
     <Route path="/metriques-evaluation" element={<MetriquesEvaluationPage />} />
     <Route path="/metriques-json" element={<JsonMetricsPage />} />
     <Route path="/pilotage-pipeline" element={<PilotagePipelinePage />} />
     <Route path="/upload" element={<UploadBulletinPage />} />
     <Route path="/map" element={<MapPage />} />
     <Route path="/validation-issues" element={<ValidationIssuesPage />} />
     <Route path="/parametres" element={<ParametresPage />} />
     <Route path="/about" element={<AboutPage />} />
     <Route path="*" element={<NotFoundPage />} />
    </Routes>

    {/* Notification flottante des tâches en arrière-plan (visible sur toutes les pages) */}
    <BackgroundTasksNotifier />
   </div>
  </BrowserRouter>
 );
}
