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

const comingSoonItems = [
  { icon: "Globe", label: "Perfil público" },
  { icon: "Link", label: "Links" },
  { icon: "Store", label: "Loja" },
  { icon: "Ticket", label: "Ingressos" },
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
  const gesture = useRef<{ id: number; x: number; y: number; moved: boolean } | null>(null);
  const suppressClick = useRef(false);
  const isSidebar = variant === "sidebar";
  const isBottom = variant === "bottom";
  const isExpandable = variant === "expandable";
  const activeLabel = navigationItems.find(item => item.section === activeSection)?.label ?? "Outras áreas";

  function closeNavigation() {
    setIsOpen(false);
    buttonRef.current?.focus();
  }

  return <nav aria-label={isSidebar ? "Navegação da banda" : isBottom ? "Navegação inferior da banda" : "Navegação da banda"}
    data-band-nav-expanded={isBottom && isOpen ? "true" : undefined}
    className={isSidebar ? "hidden md:block" : isBottom ? "fixed inset-x-0 bottom-0 z-30 touch-pan-x border-t border-nav-border bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden" : "relative"}
    onPointerDown={isBottom ? event => {
      if (!event.isPrimary || event.button !== 0) return;
      suppressClick.current = false;
      gesture.current = { id: event.pointerId, x: event.clientX, y: event.clientY, moved: false };
    } : undefined}
    onPointerMove={isBottom ? event => {
      const start = gesture.current;
      if (!start || start.id !== event.pointerId) return;
      const dy = event.clientY - start.y, dx = event.clientX - start.x;
      if (!start.moved && Math.abs(dy) >= 28 && Math.abs(dy) > Math.abs(dx) * 1.5) {
        start.moved = true;
        suppressClick.current = true;
        event.currentTarget.setPointerCapture(event.pointerId);
        setIsOpen(dy < 0);
      }
    } : undefined}
    onPointerUp={isBottom ? () => { gesture.current = null; } : undefined}
    onPointerCancel={isBottom ? () => { gesture.current = null; suppressClick.current = false; } : undefined}
    onClickCapture={isBottom ? event => {
      if (suppressClick.current && event.detail !== 0) { event.preventDefault(); event.stopPropagation(); suppressClick.current = false; }
    } : undefined}
    onKeyDown={event => {
      if (event.key === "Escape" && isOpen && (isExpandable || isBottom)) { event.preventDefault(); closeNavigation(); }
    }}>
    {isBottom && <button ref={buttonRef} type="button" aria-expanded={isOpen} aria-controls={`${panelId}-extras`}
      aria-label={isOpen ? "Recolher opções da banda" : "Expandir opções da banda"}
      onClick={() => setIsOpen(open => !open)}
      className={`relative flex h-3 w-full items-center justify-center text-content-muted before:absolute before:inset-x-0 before:-top-8 before:bottom-0 before:content-[''] hover:text-brand ${focusStyles}`}>
      <span aria-hidden="true" className="h-[3px] w-7 rounded-full bg-current" />
    </button>}
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
        {isSidebar && comingSoonItems.map(item => <li key={item.label}>
          <span aria-disabled="true" className="flex min-h-11 items-center justify-between gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold text-content-faint">
            <span className="flex min-w-0 items-center gap-3"><NavigationIcon name={item.icon} />{item.label}</span>
            <span className="shrink-0 rounded-full bg-disabled-surface px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-content-subtle">Em breve</span>
          </span>
        </li>)}
      </ul>
    </div>
    {isBottom && <div id={`${panelId}-extras`} aria-hidden={!isOpen}
      className={`grid transition-[grid-template-rows,opacity] duration-200 ease-out motion-reduce:transition-none ${isOpen ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"}`}>
      <div className="min-h-0 overflow-hidden">
        <ul className="mx-auto grid max-w-xl grid-cols-4 border-t border-nav-border">
          {[comingSoonItems[0], comingSoonItems[1], comingSoonItems[3], comingSoonItems[2]].map(item => <li key={item.label}>
            <span aria-disabled="true" className="flex min-h-20 flex-col items-center justify-center gap-1 px-1 py-2 text-center text-[0.65rem] font-semibold text-content-faint">
              <NavigationIcon name={item.icon} />
              <span>{item.label}</span>
              <span className="rounded-full bg-disabled-surface px-1.5 py-0.5 text-[9px] uppercase text-content-subtle">Em breve</span>
            </span>
          </li>)}
        </ul>
      </div>
    </div>}
  </nav>;
}
