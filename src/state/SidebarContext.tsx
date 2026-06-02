import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

const STORAGE_KEY = "nimbus.telemetry.sidebar.collapsed";

type SidebarContextValue = {
  collapsed: boolean;
  toggle: () => void;
  drawerOpen: boolean;
  openDrawer: () => void;
  closeDrawer: () => void;
};

const SidebarContext = createContext<SidebarContextValue | null>(null);

function readPersistedCollapsed(): boolean {
  try {
    return globalThis.localStorage?.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export function SidebarProvider({ children }: { children: ReactNode }) {
  const [collapsed, setCollapsed] = useState<boolean>(readPersistedCollapsed);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const toggle = useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        globalThis.localStorage?.setItem(STORAGE_KEY, next ? "1" : "0");
      } catch {
        /* private mode; ignore */
      }
      return next;
    });
  }, []);

  const openDrawer = useCallback(() => setDrawerOpen(true), []);
  const closeDrawer = useCallback(() => setDrawerOpen(false), []);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.defaultPrevented) return;
      if (event.key === "Escape" && drawerOpen) {
        event.preventDefault();
        closeDrawer();
        return;
      }
      const cmdB = (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "b";
      if (!cmdB) return;
      event.preventDefault();
      toggle();
    }
    globalThis.addEventListener("keydown", onKey);
    return () => globalThis.removeEventListener("keydown", onKey);
  }, [toggle, drawerOpen, closeDrawer]);

  const value = useMemo<SidebarContextValue>(
    () => ({ collapsed, toggle, drawerOpen, openDrawer, closeDrawer }),
    [collapsed, toggle, drawerOpen, openDrawer, closeDrawer],
  );

  return <SidebarContext.Provider value={value}>{children}</SidebarContext.Provider>;
}

export function useSidebar(): SidebarContextValue {
  const ctx = useContext(SidebarContext);
  if (!ctx) throw new Error("useSidebar must be used within a SidebarProvider");
  return ctx;
}
