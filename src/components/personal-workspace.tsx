"use client";

import { useId, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import NavigationIcon, { type NavigationIconName } from "@/components/navigation-icon";
import ThemeSelector from "@/components/theme-selector";
import PersonalAccountName from "@/components/personal-account-name";

const items: { href: string; label: string; icon: NavigationIconName }[] = [
  { href: "/meu-perfil", label: "Visão geral", icon: "LayoutDashboard" },
  { href: "/meu-perfil/tarefas", label: "Tarefas", icon: "ListTodo" },
  { href: "/meu-perfil/agenda", label: "Agenda", icon: "CalendarDays" },
  { href: "/meu-perfil/links", label: "Links", icon: "Link" },
  { href: "/meu-perfil/perfil-publico", label: "Perfil público", icon: "Globe" },
  { href: "/meu-perfil/configuracoes", label: "Configurações", icon: "Settings" },
  { href: "/dashboard", label: "Minhas bandas", icon: "Users" },
];

export function PersonalNavigation({ sidebar = false }: { sidebar?: boolean }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const close = () => { setOpen(false); trigger.current?.focus(); };
  return <nav aria-label="Navegação do meu perfil" onKeyDown={event => {
    if (event.key === "Escape" && open && !sidebar) { event.preventDefault(); close(); }
  }}>
    {!sidebar && <button ref={trigger} type="button" aria-expanded={open} aria-controls={panelId}
      onClick={() => setOpen(value => !value)}
      className="flex min-h-11 w-full items-center justify-between gap-3 rounded-xl border border-accent-border bg-surface px-4 py-3 text-sm font-semibold text-brand focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-focus">
      Menu do meu perfil <span aria-hidden="true">{open ? "×" : "☰"}</span>
    </button>}
    <div id={panelId} hidden={!sidebar && !open} className={sidebar ? "" : "mt-3 rounded-2xl border border-nav-border bg-surface p-3"}>
      <ul className={sidebar ? "space-y-1" : "grid gap-2 sm:grid-cols-2"}>
        {items.map(item => <li key={item.href}>
          <Link href={item.href} aria-current={pathname === item.href ? "page" : undefined}
            onClick={sidebar ? undefined : close}
            className={`flex min-h-11 items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-focus ${pathname === item.href ? "bg-accent-soft text-brand" : "text-content-muted hover:bg-accent-soft hover:text-brand"}`}>
            <NavigationIcon name={item.icon} />{item.label}
          </Link>
        </li>)}
      </ul>
      <div className="mt-3 border-t border-nav-border px-3 pt-3"><ThemeSelector showIcon /></div>
    </div>
  </nav>;
}

export default function PersonalWorkspace({ children }: { children: ReactNode }) {
  return <div className="flex min-w-0 flex-1 flex-col md:pl-64 lg:pl-72">
    <aside aria-label="Menu lateral do meu perfil" className="fixed inset-y-0 left-0 z-20 hidden w-64 flex-col overflow-y-auto overscroll-contain border-r border-nav-border bg-surface px-5 py-6 md:flex lg:w-72 lg:px-6">
      <Link href="/dashboard" className="rounded text-xl font-bold tracking-tight text-content focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-focus">Band<span className="text-accent">Up</span></Link>
      <div className="mt-10 rounded-2xl bg-accent-soft p-4">
        <p className="text-xs font-semibold uppercase tracking-widest text-accent">Área pessoal</p>
        <PersonalAccountName />
        <p className="mt-1 text-xs leading-5 text-content-subtle">Seu espaço em todas as suas bandas.</p>
      </div>
      <div className="mt-8"><PersonalNavigation sidebar /></div>
    </aside>
    <div className="min-w-0 px-4 pt-5 md:hidden"><PersonalNavigation /></div>
    <div className="flex min-w-0 flex-1 flex-col">{children}</div>
  </div>;
}
