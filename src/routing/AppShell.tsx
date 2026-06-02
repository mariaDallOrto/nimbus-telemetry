import { Suspense, lazy } from "react";
import { Route, Routes } from "react-router-dom";
import { MobileTopBar } from "../components/layout/MobileTopBar";
import { SideRail } from "../components/layout/SideRail";
import { SidebarProvider, useSidebar } from "../state/SidebarContext";
import { TelemetryProvider } from "../telemetry/TelemetryContext";

const LivePage = lazy(() => import("../pages/LivePage"));
const AnalysisPage = lazy(() => import("../pages/AnalysisPage"));

function PendingShell() {
  return (
    <main className="nb-main">
      <div className="nb-content" aria-busy="true" aria-live="polite">
        <span className="nb-visually-hidden">Carregando…</span>
      </div>
    </main>
  );
}

function ShellLayout() {
  const { collapsed, drawerOpen, closeDrawer } = useSidebar();
  return (
    <div
      className={`nb-shell${collapsed ? " is-rail-collapsed" : ""}${drawerOpen ? " is-drawer-open" : ""}`}
    >
      <a className="nb-skip-link" href="#nb-main-content">
        Pular para o conteúdo
      </a>
      <MobileTopBar />
      <SideRail />
      {drawerOpen ? (
        <button
          type="button"
          tabIndex={-1}
          className="nb-rail-backdrop"
          aria-label="Fechar navegação"
          onClick={closeDrawer}
        />
      ) : null}
      <div id="nb-main-content" className="nb-shell__content" inert={drawerOpen} tabIndex={-1}>
        <Suspense fallback={<PendingShell />}>
          <Routes>
            <Route path="/" element={<LivePage />} />
            <Route path="/analise" element={<AnalysisPage />} />
          </Routes>
        </Suspense>
      </div>
    </div>
  );
}

export function AppShell() {
  return (
    <TelemetryProvider>
      <SidebarProvider>
        <ShellLayout />
      </SidebarProvider>
    </TelemetryProvider>
  );
}
