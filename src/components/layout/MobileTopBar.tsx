import { useNavigate } from "react-router-dom";
import { useSidebar } from "../../state/SidebarContext";

export function MobileTopBar() {
  const navigate = useNavigate();
  const { drawerOpen, openDrawer } = useSidebar();

  return (
    <header className="nb-mobile-topbar">
      <button
        type="button"
        className="nb-mobile-topbar__hamburger"
        onClick={openDrawer}
        aria-label="Abrir navegação"
        aria-expanded={drawerOpen}
        aria-controls="nb-rail"
      >
        <span className="nb-mobile-topbar__hamburger-bars" aria-hidden>
          <span />
          <span />
          <span />
        </span>
      </button>
      <button
        type="button"
        className="nb-mobile-topbar__brand"
        onClick={() => navigate("/")}
        aria-label="Ir para o monitoramento ao vivo"
      >
        <span className="nb-mobile-topbar__brand-mark" aria-hidden>
          N
        </span>
        <span className="nb-mobile-topbar__brand-name">
          Nimbus<span> </span>Telemetry
        </span>
      </button>
    </header>
  );
}
