"use client";

import { useId, useRef, useState } from "react";
import Link from "next/link";

const navigationItems = [
  { section: "overview", label: "Visão geral", suffix: "" },
  { section: "tarefas", label: "Tarefas", suffix: "/tarefas" },
  { section: "agenda", label: "Agenda", suffix: "/agenda" },
  { section: "membros", label: "Membros", suffix: "/membros" },
  { section: "links", label: "Links", suffix: "/links" },
] as const;

type BandSection = (typeof navigationItems)[number]["section"];

type BandNavigationProps = {
  bandId: string;
  activeSection: BandSection;
  variant?: "sidebar" | "expandable";
};

const focusStyles = "focus:outline-none focus:ring-4 focus:ring-violet-200";

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
          className={`flex min-h-11 w-full items-center justify-between gap-3 rounded-xl border border-violet-200 bg-white px-4 py-3 text-left text-sm font-semibold text-violet-800 transition hover:bg-violet-50 ${focusStyles}`}
        >
          <span>{activeLabel} <span aria-hidden="true">·</span> Menu da banda</span>
          <span aria-hidden="true" className="shrink-0 text-lg leading-none">{isOpen ? "×" : "☰"}</span>
        </button>
      )}

      <div id={panelId} hidden={!isSidebar && !isOpen} className={isSidebar ? "" : "mt-3 rounded-2xl border border-violet-100 bg-white p-3"}>
        <ul className={isSidebar ? "space-y-1" : "grid grid-cols-1 gap-2 sm:grid-cols-2"}>
          {navigationItems.map((item) => {
            const active = item.section === activeSection;
            return (
              <li key={item.section}>
                <Link
                  href={`/bandas/${bandId}${item.suffix}`}
                  onClick={isSidebar ? undefined : closeNavigation}
                  aria-current={active ? "page" : undefined}
                  className={`flex min-h-11 items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition ${focusStyles} ${
                    active
                      ? isSidebar ? "bg-violet-50 text-violet-800" : "bg-violet-700 text-white"
                      : isSidebar ? "text-zinc-600 hover:bg-violet-50 hover:text-violet-800" : "border border-violet-200 text-violet-800 hover:bg-violet-50"
                  }`}
                >
                  <span aria-hidden="true" className={`h-2 w-2 shrink-0 rounded-full ${active ? isSidebar ? "bg-violet-500" : "bg-white" : "bg-zinc-300"}`} />
                  {item.label}
                </Link>
              </li>
            );
          })}
          <li>
            <span aria-disabled="true" className="flex min-h-11 flex-wrap items-center justify-between gap-2 rounded-xl px-3 py-2.5 text-sm text-zinc-500">
              Configurações
              <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-zinc-500">Em breve</span>
            </span>
          </li>
        </ul>
        {!isSidebar && (
          <Link href="/dashboard" onClick={closeNavigation} className={`mt-2 flex min-h-11 items-center rounded-xl px-3 py-2.5 text-sm font-medium text-zinc-600 transition hover:bg-violet-50 hover:text-violet-800 ${focusStyles}`}>
            ← Voltar para minhas bandas
          </Link>
        )}
      </div>
    </nav>
  );
}
