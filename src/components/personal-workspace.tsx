"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import NavigationIcon, { type NavigationIconName } from "@/components/navigation-icon";
import PersonalAccountName from "@/components/personal-account-name";
import { SpaceSwitcherHeader } from "@/components/space-switcher";
import { WorkspaceSettingsNavigation } from "@/components/workspace-settings";

const items: { href: string; label: string; icon: NavigationIconName }[] = [
  { href: "/dashboard", label: "Visão geral", icon: "LayoutDashboard" },
  { href: "/dashboard/tarefas", label: "Tarefas", icon: "ListTodo" },
  { href: "/dashboard/agenda", label: "Agenda", icon: "CalendarDays" },
  { href: "/dashboard/bandas", label: "Minhas Bandas", icon: "Users" },
];

export function PersonalNavigation({ sidebar = false }: { sidebar?: boolean }) {
  const pathname = usePathname();
  return <nav aria-label={sidebar ? "Navegação do Meu Painel" : "Navegação inferior do Meu Painel"}
    className={sidebar ? "hidden md:block" : "fixed inset-x-0 bottom-0 z-30 border-t border-nav-border bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"}>
    <ul className={sidebar ? "space-y-1" : "mx-auto grid max-w-xl grid-cols-4"}>
      {items.map(item => {
        const active = pathname === item.href || (item.href !== "/dashboard" && pathname.startsWith(`${item.href}/`));
        const classes = sidebar
          ? `flex min-h-11 items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-focus ${active ? "bg-accent-soft text-brand" : "text-content-muted hover:bg-accent-soft hover:text-brand"}`
          : `relative flex min-h-[4.25rem] flex-col items-center justify-center gap-1 px-1 text-[0.65rem] font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus ${active ? "text-brand before:absolute before:top-1 before:h-0.5 before:w-8 before:rounded-full before:bg-primary" : "text-content-muted hover:text-brand"}`;
        return <li key={item.href}><Link href={item.href} aria-current={active ? "page" : undefined} className={classes}>
          <NavigationIcon name={item.icon} />{item.label}
        </Link></li>;
      })}
    </ul>
  </nav>;
}

export default function PersonalWorkspace({ children }: { children: ReactNode }) {
  return <div className="workspace-theme flex min-w-0 flex-1 flex-col md:pl-64 lg:pl-72">
    <aside aria-label="Menu lateral do Meu Painel" className="fixed inset-y-0 left-0 z-20 hidden w-64 flex-col gap-8 overflow-y-auto overscroll-contain border-r border-nav-border bg-surface px-5 py-6 md:flex lg:w-72 lg:px-6">
      <Link href="/dashboard" className="flex min-h-16 w-full shrink-0 items-center rounded text-[2.625rem] leading-none font-bold tracking-tight text-content focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-focus">Band<span className="text-accent">Up</span></Link>
      <div className="min-w-0 shrink-0 rounded-2xl bg-accent-soft p-4">
        <p className="text-xs font-semibold uppercase tracking-widest text-accent">Área pessoal</p>
        <PersonalAccountName />
        <p className="mt-1 text-xs leading-5 text-content-subtle">Seu espaço em todas as suas bandas.</p>
      </div>
      <PersonalNavigation sidebar />
      <div className="mt-auto w-full"><WorkspaceSettingsNavigation href="/dashboard/configuracoes" /></div>
    </aside>
    <SpaceSwitcherHeader settingsHref="/dashboard/configuracoes" />
    <PersonalNavigation />
    <div className="flex min-w-0 flex-1 flex-col pb-[calc(5rem+env(safe-area-inset-bottom))] md:pb-0">{children}</div>
  </div>;
}
