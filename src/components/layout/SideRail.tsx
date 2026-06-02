import { useEffect, useRef } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { useSidebar } from "../../state/SidebarContext";
import { useTelemetry } from "../../telemetry/TelemetryContext";
import { ConnectionStatusBadge } from "../ConnectionStatusBadge";

type RailLink = { to: string; icon: string; label: string };

const NAV_LINKS: readonly RailLink[] = [
  { to: "/", icon: "📡", label: "Monitoramento ao Vivo" },
  { to: "/analise", icon: "📈", label: "Análise de CSV" },
];

export function SideRail() {
  const navigate = useNavigate();
  const { collapsed, toggle, drawerOpen, closeDrawer } = useSidebar();
  const { status } = useTelemetry();
  const railRef = useRef<HTMLElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!drawerOpen) return;
    previouslyFocused.current = document.activeElement as HTMLElement | null;
    const rail = railRef.current;
    if (!rail) return;
    const focusables = rail.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
    );
    focusables[0]?.focus();
    return () => {
      const prev = previouslyFocused.current;
      if (!prev || !document.contains(prev) || prev.closest("[inert]")) return;
      prev.focus();
    };
  }, [drawerOpen]);

  const handleNavClick = () => {
    if (drawerOpen) closeDrawer();
  };

  return (
    <aside
      ref={railRef}
      id="nb-rail"
      className={`nb-rail${collapsed ? " is-collapsed" : ""}${drawerOpen ? " is-drawer-open" : ""}`}
      role={drawerOpen ? "dialog" : undefined}
      aria-modal={drawerOpen ? true : undefined}
      aria-label={drawerOpen ? "Navegação" : undefined}
    >
      <div className="nb-rail__header">
        <button
          type="button"
          className="nb-rail__brand"
          onClick={() => navigate("/")}
          aria-label="Ir para o monitoramento ao vivo"
        >
          <span className="nb-rail__brand-mark" aria-hidden>
            N
          </span>
          <span className="nb-rail__brand-text">
            <span className="nb-rail__brand-name">
              Nimbus<span> </span>Telemetry
            </span>
            <span className="nb-rail__brand-tagline">R84 · HSTS016L</span>
          </span>
        </button>
        <button
          type="button"
          className="nb-rail__toggle"
          onClick={toggle}
          aria-label={collapsed ? "Expandir navegação" : "Recolher navegação"}
          aria-expanded={!collapsed}
          title={collapsed ? "Expandir (⌘B / Ctrl+B)" : "Recolher (⌘B / Ctrl+B)"}
        >
          <span aria-hidden>{collapsed ? "›" : "‹"}</span>
        </button>
      </div>

      <nav className="nb-rail__nav" aria-label="Navegação principal">
        <div className="nb-rail__group-label">Telemetria</div>
        {NAV_LINKS.map((link) => (
          <NavLink
            key={link.to}
            to={link.to}
            end={link.to === "/"}
            onClick={handleNavClick}
            className={({ isActive }) => `nb-rail__link${isActive ? " is-active" : ""}`}
            title={collapsed ? link.label : undefined}
          >
            <span className="nb-rail__link-icon" aria-hidden>
              {link.icon}
            </span>
            <span className="nb-rail__link-label">{link.label}</span>
          </NavLink>
        ))}
      </nav>

      <div className="nb-rail__footer">
        <ConnectionStatusBadge status={status} />
      </div>
    </aside>
  );
}
