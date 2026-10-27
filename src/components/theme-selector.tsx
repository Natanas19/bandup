"use client";

import { useId } from "react";
import NavigationIcon from "@/components/navigation-icon";
import { useTheme } from "@/components/theme-provider";
import { normalizeThemePreference } from "@/lib/theme";

export default function ThemeSelector({ className = "", showIcon = false }: { className?: string; showIcon?: boolean }) {
  const id = useId();
  const { preference, setPreference, ready } = useTheme();
  return (
    <div className={`inline-flex min-w-0 flex-col gap-1.5 ${className}`}>
      <label htmlFor={id} className="inline-flex items-center gap-3 text-sm font-medium text-content-muted">{showIcon && <NavigationIcon name="Palette" />}Aparência</label>
      <select id={id} value={preference} disabled={!ready}
        onChange={(event) => setPreference(normalizeThemePreference(event.target.value))}
        className="min-h-11 w-40 max-w-full rounded-xl border border-outline bg-surface px-3 py-2 text-base text-content outline-none focus:border-primary focus:ring-4 focus:ring-focus md:text-sm">
        <option value="light">Claro</option>
        <option value="dark">Escuro</option>
        <option value="system">Automático</option>
      </select>
    </div>
  );
}
