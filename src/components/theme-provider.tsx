"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createThemeController, type ResolvedTheme, type ThemePreference, type ThemeSnapshot } from "@/lib/theme";

type ThemeContextValue = {
  preference: ThemePreference;
  resolvedTheme: ResolvedTheme | null;
  ready: boolean;
  setPreference: (value: ThemePreference) => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const controller = useRef<ReturnType<typeof createThemeController> | null>(null);
  // The server and first client render deliberately use the same neutral state.
  // The head initializer has already applied the real colors to the document.
  const [snapshot, setSnapshot] = useState<ThemeSnapshot | null>(null);

  useEffect(() => {
    const active = createThemeController(window, document);
    controller.current = active;
    const unsubscribe = active.subscribe(setSnapshot);
    setSnapshot(active.getSnapshot());
    return () => {
      unsubscribe();
      active.dispose();
      controller.current = null;
    };
  }, []);

  const setPreference = useCallback((value: ThemePreference) => {
    controller.current?.setPreference(value);
  }, []);
  const value = useMemo(() => ({
    preference: snapshot?.preference ?? "system" as ThemePreference,
    resolvedTheme: snapshot?.resolvedTheme ?? null,
    ready: snapshot !== null,
    setPreference,
  }), [snapshot, setPreference]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) throw new Error("useTheme deve ser usado dentro de ThemeProvider.");
  return context;
}
