"use client";

import { useId, useRef, useState } from "react";
import Link from "next/link";
import NavigationIcon from "@/components/navigation-icon";

const navigationItems = [
  { icon: "LayoutDashboard", section: "overview", label: "Visão geral", suffix: "" },
  { icon: "ListTodo", section: "tarefas", label: "Tarefas", suffix: "/tarefas" },
  { icon: "CalendarDays", section: "agenda", label: "Agenda", suffix: "/agenda" },
  { icon: "Users", section: "membros", label: "Membros", suffix: "/membros" },
] as const;

type BandSection = (typeof navigationItems)[number]["section"] | "links" | "perfil-publico";
type BandNavigationProps = {
  bandId: string;
  activeSection: BandSection;
  variant?: "sidebar" | "bottom" | "expandable";
};

const focusStyles = "focus:outline-none focus:ring-4 focus:ring-focus";

export default function BandNavigation({ bandId, activeSection, variant = "bottom" }: BandNavigationProps) {
  const [isOpen, setIsOpen] = useState(false);
  const panelId = useId();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const isSidebar = variant === "sidebar";
  const isBottom = variant === "bottom";
  const isExpandable = variant === "expandable";
  const activeLabel = navigationItems.find(item => item.section === activeSection)?.label ?? "Outras áreas";

  function closeNavigation() {
    setIsOpen(false);
    buttonRef.current?.focus();
  }

  return <nav aria-label={isSidebar ? "Navegação da banda" : isBottom ? "Navegação inferior da banda" : "Navegação da banda"}
    className={isSidebar ? "hidden md:block" : isBottom ? "fixed inset-x-0 bottom-0 z-30 border-t border-nav-border bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden" : "relative"}
    onKeyDown={event => {
      if (event.key === "Escape" && isOpen && isExpandable) { event.preventDefault(); closeNavigation(); }
    }}>
    {isExpandable && <button ref={buttonRef} type="button" aria-expanded={isOpen} aria-controls={panelId}
      onClick={() => setIsOpen(open => !open)}
      className={`flex min-h-11 w-full items-center justify-between gap-3 rounded-xl border border-accent-border bg-surface px-4 py-3 text-left text-sm font-semibold text-brand transition hover:bg-accent-soft ${focusStyles}`}>
      <span>{activeLabel} <span aria-hidden="true">·</span> Navegação da banda</span>
      <span aria-hidden="true" className="shrink-0 text-lg leading-none">{isOpen ? "×" : "☰"}</span>
    </button>}
    <div id={panelId} hidden={isExpandable && !isOpen}
      className={isSidebar ? "" : isBottom ? "" : "mt-3 rounded-2xl border border-nav-border bg-surface p-3"}>
      <ul className={isSidebar ? "space-y-1" : isBottom ? "mx-auto grid max-w-xl grid-cols-4" : "grid grid-cols-1 gap-2 sm:grid-cols-2"}>
        {navigationItems.map(item => {
          const active = item.section === activeSection;
          const linkStyle = isSidebar
            ? active ? "bg-accent-soft text-brand" : "text-content-muted hover:bg-accent-soft hover:text-brand"
            : isBottom
              ? active ? "text-brand before:absolute before:top-1 before:h-0.5 before:w-8 before:rounded-full before:bg-primary" : "text-content-muted hover:text-brand"
              : active ? "bg-primary text-on-primary" : "border border-accent-border text-brand hover:bg-accent-soft";
          const itemLayout = isSidebar
            ? "flex min-h-11 items-center gap-3 rounded-xl px-3 py-2.5 text-sm"
            : isBottom
              ? "relative flex min-h-[4.25rem] flex-col items-center justify-center gap-1 px-1 text-[0.65rem]"
              : "flex min-h-11 items-center gap-3 rounded-xl px-3 py-2.5 text-sm";
          return <li key={item.section}><Link href={`/bandas/${bandId}${item.suffix}`}
            onClick={isExpandable ? closeNavigation : undefined} aria-current={active ? "page" : undefined}
            className={`${itemLayout} font-semibold transition ${focusStyles} ${linkStyle}`}>
            <NavigationIcon name={item.icon} />{item.label}
          </Link></li>;
        })}
      </ul>
    </div>
  </nav>;
}
