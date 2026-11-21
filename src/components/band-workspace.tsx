"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import BandNavigation from "@/components/band-navigation";
import WorkspaceSearch from "@/components/workspace-search";
import { WorkspaceSettingsNavigation } from "@/components/workspace-settings";
import { PUBLIC_IDENTITY_ENABLED } from "@/lib/publication-control";

type BandInfo = { name: string; role?: string };
const BandInfoContext = createContext<((info: BandInfo) => void) | null>(null);

// Reuse data already authorized and loaded by each page; no extra Auth or queries.
export function BandWorkspaceInfo({ name, role }: BandInfo) {
  const setInfo = useContext(BandInfoContext);
  useEffect(() => { setInfo?.({ name, role }); }, [setInfo, name, role]);
  return null;
}

export default function BandWorkspace({ bandId, children }: { bandId: string; children: ReactNode }) {
  const pathname = usePathname();
  const [info, setInfo] = useState<BandInfo | null>(null);
  const section = pathname.split("/")[3];
  const activeSection = section === "tarefas" || section === "agenda" || section === "membros" || section === "links" || section === "perfil-publico" || section === "configuracoes" ? section : "overview";
  const settingsHref = `/bandas/${bandId}/${PUBLIC_IDENTITY_ENABLED ? "configuracoes" : "perfil-publico"}`;

  return (
    <BandInfoContext.Provider value={setInfo}>
      <div className="workspace-theme group/band flex min-w-0 flex-1 flex-col md:pl-64 lg:pl-72">
        <aside aria-label="Menu lateral da banda" className="fixed inset-y-0 left-0 z-20 hidden w-64 flex-col gap-8 overflow-y-auto overscroll-contain border-r border-nav-border bg-surface px-5 py-6 md:flex lg:w-72 lg:px-6">
          <Link href="/dashboard" className="flex min-h-16 w-full shrink-0 items-center rounded text-[2.625rem] leading-none font-bold tracking-tight text-content focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-focus">Band<span className="text-accent">Up</span></Link>
          {info && <div className="min-w-0 shrink-0 rounded-2xl bg-accent-soft p-4">
            <p className="text-[11px] font-semibold tracking-[0.16em] text-accent-strong uppercase">Banda ativa</p>
            <p className="mt-2 break-words text-base font-semibold text-content [overflow-wrap:anywhere]">{info.name}</p>
            {info.role && <p className="mt-1 text-xs text-content-subtle">{info.role === "admin" ? "Administrador" : "Membro"}</p>}
          </div>}
          <div>
            <p className="mb-3 px-3 text-[11px] font-semibold tracking-[0.16em] text-content-faint uppercase">Workspace</p>
            <BandNavigation bandId={bandId} activeSection={activeSection} variant="sidebar" />
          </div>
          <div className="mt-auto w-full">
            <WorkspaceSettingsNavigation href={settingsHref} />
          </div>
          <Link href="/dashboard" className="flex min-h-11 shrink-0 items-center rounded-xl px-3 py-3 text-sm font-medium text-content-muted transition hover:bg-accent-soft hover:text-brand focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-focus">
            ← Voltar ao Meu Painel
          </Link>
        </aside>
        <div className="flex min-w-0 flex-1 flex-col">
          <WorkspaceSearch bandId={bandId} bandName={info?.name} settingsHref={settingsHref}
            searchNavigation={<BandNavigation bandId={bandId} activeSection={activeSection} />}
            contentClassName="flex min-w-0 flex-1 flex-col pb-[calc(7.5rem+env(safe-area-inset-bottom))] group-has-[[data-band-nav-expanded=true]]/band:pb-[calc(13rem+env(safe-area-inset-bottom))] motion-safe:transition-[padding-bottom] motion-safe:duration-200 md:pb-0 md:group-has-[[data-band-nav-expanded=true]]/band:pb-0">{children}</WorkspaceSearch>
        </div>
      </div>
    </BandInfoContext.Provider>
  );
}
