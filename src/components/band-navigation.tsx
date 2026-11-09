"use client";

import { useId, useRef, useState } from "react";
import Link from "next/link";
import ThemeSelector from "@/components/theme-selector";
import NavigationIcon from "@/components/navigation-icon";

const navigationItems = [
  { icon: "LayoutDashboard", section: "overview", label: "Visão geral", suffix: "" },
  { icon: "ListTodo", section: "tarefas", label: "Tarefas", suffix: "/tarefas" },
  { icon: "CalendarDays", section: "agenda", label: "Agenda", suffix: "/agenda" },
  { icon: "Users", section: "membros", label: "Membros", suffix: "/membros" },
  { icon: "Link", section: "links", label: "Links", suffix: "/links" },
  { icon: "Globe", section: "perfil-publico", label: "Perfil Público", suffix: "/perfil-publico" },
] as const;

type BandSection = (typeof navigationItems)[number]["section"];

type BandNavigationProps = {
  bandId: string;
  activeSection: BandSection;
  variant?: "sidebar" | "expandable";
};

const focusStyles = "focus:outline-none focus:ring-4 focus:ring-focus";

export default function BandNavigation({
  bandId,
  activeSection,
  variant = "expandable",
}: BandNavigationProps) {
  const [isOpen, setIsOpen] = useState(false);
  const panelId = useId();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const isSidebar = variant === "sidebar";
  const activeLabel = navigationItems.find((item) => item.section === activeSection)?.label;

  function closeNavigation() {
    setIsOpen(false);
    buttonRef.current?.focus();
  }

  return (
    <nav
      aria-label="Navegação da banda"
      onKeyDown={(event) => {
        if (event.key === "Escape" && isOpen && !isSidebar) {
          event.preventDefault();
          closeNavigation();
        }
      }}
    >
      {!isSidebar && (
        <button
          ref={buttonRef}
          type="button"
          aria-expanded={isOpen}
          aria-controls={panelId}
          onClick={() => setIsOpen((open) => !open)}
          className={`flex min-h-11 w-full items-center justify-between gap-3 rounded-xl border border-accent-border bg-surface px-4 py-3 text-left text-sm font-semibold text-brand transition hover:bg-accent-soft ${focusStyles}`}
        >
          <span>{activeLabel} <span aria-hidden="true">·</span> Menu da banda</span>
          <span aria-hidden="true" className="shrink-0 text-lg leading-none">{isOpen ? "×" : "☰"}</span>
        </button>
      )}

      <div id={panelId} hidden={!isSidebar && !isOpen} className={isSidebar ? "" : "mt-3 rounded-2xl border border-nav-border bg-surface p-3"}>
        <ul className={isSidebar ? "space-y-1" : "grid grid-cols-1 gap-2 sm:grid-cols-2"}>
          {navigationItems.map((item) => {
            const active = item.section === activeSection;
            return (
              <li key={item.section}>
                {item.section === "links" || item.section === "perfil-publico" ? (
                  <span aria-disabled="true" className="flex min-h-11 flex-wrap items-center justify-between gap-2 rounded-xl px-3 py-2.5 text-sm text-content-subtle">
                    <span className="inline-flex items-center gap-3"><NavigationIcon name={item.icon} />{item.label}</span>
                    <span className="rounded-full bg-disabled-surface px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-content-subtle">Em breve</span>
                  </span>
                ) : <Link
                  href={`/bandas/${bandId}${item.suffix}`}
                  onClick={isSidebar ? undefined : closeNavigation}
                  aria-current={active ? "page" : undefined}
                  className={`flex min-h-11 items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition ${focusStyles} ${
                    active
                      ? isSidebar ? "bg-accent-soft text-brand" : "bg-primary text-on-primary"
                      : isSidebar ? "text-content-muted hover:bg-accent-soft hover:text-brand" : "border border-accent-border text-brand hover:bg-accent-soft"
                  }`}
                >
                  <NavigationIcon name={item.icon} />
                  {item.label}
                </Link>}
              </li>
            );
          })}
          <li>
            <span aria-disabled="true" className="flex min-h-11 flex-wrap items-center justify-between gap-2 rounded-xl px-3 py-2.5 text-sm text-content-subtle">
              <span className="inline-flex items-center gap-3"><NavigationIcon name="Settings" />Configurações</span>
              <span className="rounded-full bg-disabled-surface px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-content-subtle">Em breve</span>
            </span>
          </li>
        </ul>
        <Link href="/meu-perfil" onClick={isSidebar ? undefined : closeNavigation}
          className={`mt-2 flex min-h-11 items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-content-muted transition hover:bg-accent-soft hover:text-brand ${focusStyles}`}>
          <NavigationIcon name="Users" />Meu Perfil
        </Link>
        {!isSidebar && (
          <Link href="/dashboard" onClick={closeNavigation} className={`mt-2 flex min-h-11 items-center rounded-xl px-3 py-2.5 text-sm font-medium text-content-muted transition hover:bg-accent-soft hover:text-brand ${focusStyles}`}>
            ← Voltar para minhas bandas
          </Link>
        )}
        <div className="mt-3 border-t border-nav-border px-3 pt-3"><ThemeSelector showIcon /></div>
      </div>
    </nav>
  );
}
