import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import "./index.css";
import { AuthGate } from "./pages/AuthGate";
import { ExpertsPage } from "./pages/Experts";
import { FindingsPage } from "./pages/Findings";
import { JoinPage } from "./pages/Join";
import { LivePage } from "./pages/Live";
import { OverviewPage } from "./pages/Overview";
import { PlanPage } from "./pages/Plan";
import { ProjectsPage } from "./pages/Projects";
import { Workspace } from "./pages/Workspace";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        {/* Participant route: token-scoped, no consultant workspace or project data. */}
        <Route path="/join/:token" element={<JoinPage />} />
        <Route element={<AuthGate />}>
          <Route path="/" element={<ProjectsPage />} />
          <Route path="/projects/:projectId" element={<Workspace />}>
            <Route index element={<OverviewPage />} />
            <Route path="experts" element={<ExpertsPage />} />
            <Route path="plan" element={<PlanPage />} />
            <Route path="live" element={<LivePage />} />
            <Route path="findings" element={<FindingsPage />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  </StrictMode>,
);
