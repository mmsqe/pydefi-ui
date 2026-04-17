"use client";

import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from "react";

const STORAGE_KEY = "sidebar_collapsed";
const BREAKPOINT = 768; // px — collapse automatically below this width

interface SidebarContextValue {
  collapsed: boolean;
  setCollapsed: (v: boolean) => void;
}

const SidebarContext = createContext<SidebarContextValue>({
  collapsed: false,
  setCollapsed: () => {},
});

function readStorage(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export function SidebarProvider({ children }: { children: ReactNode }) {
  // Start false on both server and client so SSR HTML matches hydration.
  // The persisted preference is applied in a useEffect after mount.
  const [userCollapsed, setUserCollapsedState] = useState(false);
  // Viewport-driven collapse — does not touch localStorage
  const [autoCollapsed, setAutoCollapsed] = useState(false);

  // Sync user preference from localStorage after mount (client-only)
  useEffect(() => {
    setUserCollapsedState(readStorage());
  }, []);

  useEffect(() => {
    function check() {
      setAutoCollapsed(window.innerWidth < BREAKPOINT);
    }
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  // Effective value: auto-collapse wins; when viewport expands, user preference is restored
  const collapsed = autoCollapsed || userCollapsed;

  const setCollapsed = useCallback((v: boolean) => {
    setUserCollapsedState(v);
    try { localStorage.setItem(STORAGE_KEY, v ? "1" : "0"); } catch { /* ignore */ }
  }, []);

  return (
    <SidebarContext.Provider value={{ collapsed, setCollapsed }}>
      {children}
    </SidebarContext.Provider>
  );
}

export function useSidebar() {
  return useContext(SidebarContext);
}
