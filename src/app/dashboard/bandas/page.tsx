"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { loadPersonalOverview, type PersonalOverview } from "@/lib/personal-profile";
import ProfileAvatar from "@/components/profile-avatar";
import { safeBandLogo } from "@/lib/public-band-data";
import BandEntryFlow from "@/components/band-entry-flow";
import { BandInvitations } from "@/components/band-invitations";

const requestOptions = [
  { panel: "sent", title: "Pedidos enviados" },
  { panel: "received", title: "Convites recebidos" },
] as const;
type RequestPanel = (typeof requestOptions)[number]["panel"];
type Panel = "bands" | "requests" | RequestPanel;
type FocusTarget = "trigger" | "heading" | RequestPanel;
const panelButton = "inline-flex min-h-11 w-fit items-center rounded-xl border border-accent-border px-3 py-2 text-sm font-semibold text-brand hover:bg-accent-soft focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-focus";

export default function PersonalBandsPage() {
  const [overview, setOverview] = useState<PersonalOverview | null>(null);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const [panel, setPanel] = useState<Panel>("bands");
  const [visited, setVisited] = useState<RequestPanel[]>([]);
  const region = useRef<HTMLElement>(null);
  const nextFocus = useRef<FocusTarget | null>(null);
  useEffect(() => {
    let active = true;
    setOverview(null);
    setError("");
    void loadPersonalOverview(getSupabaseBrowserClient()).then(data => {
      if (active) setOverview(data);
    }).catch(() => {
      if (active) setError("Não foi possível carregar suas bandas. Tente novamente.");
    });
    return () => { active = false; };
  }, [revision]);

  useEffect(() => {
    const target = nextFocus.current;
    if (!target) return;
    nextFocus.current = null;
    region.current?.querySelector<HTMLElement>(`[data-panel-focus="${target}"]`)?.focus();
  }, [panel]);

  function navigate(next: Panel, focus: FocusTarget = "heading") {
    nextFocus.current = focus;
    if (next === "sent" || next === "received") {
      setVisited(current => current.includes(next) ? current : [...current, next]);
    }
    setPanel(next);
  }

  return <main ref={region} className="min-w-0 flex-1 px-4 py-6 sm:px-6 sm:py-8 lg:px-10 lg:py-10">
    <div className="mx-auto w-full max-w-4xl">
      {panel === "bands" ? <>
      <header>
        <p className="text-xs font-semibold uppercase tracking-widest text-accent">Meu Painel</p>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
          <h1 className="text-3xl font-semibold tracking-tight text-content sm:text-4xl">Minhas Bandas</h1>
          <button type="button" data-panel-focus="trigger" className={panelButton}
            onClick={() => navigate("requests")}>Solicitações</button>
        </div>
        <p className="mt-3 text-sm leading-6 text-content-muted">Acesse rapidamente os painéis das bandas de que você participa.</p>
      </header>
      {error ? <section className="mt-7 rounded-2xl border border-nav-border bg-surface p-5">
        <p role="alert" className="text-sm text-danger">{error}</p>
        <button type="button" onClick={() => setRevision(value => value + 1)} className="mt-4 min-h-11 rounded-xl border border-accent-border px-4 py-3 text-sm font-semibold text-brand focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-focus">Tentar novamente</button>
      </section> : !overview ? <p role="status" className="mt-7 text-sm text-content-muted">Carregando suas bandas...</p> : overview.bands.length ? <ul className="mt-7 space-y-3">
        {overview.bands.map(({ band, role }) => <li key={band.id}>
          <Link href={`/bandas/${band.id}`} className="flex min-h-11 flex-col gap-3 rounded-2xl border border-nav-border bg-surface p-4 hover:bg-accent-soft focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-focus sm:flex-row sm:items-center sm:justify-between">
            <span className="flex min-w-0 items-center gap-3">
              <ProfileAvatar name={band.name} imageUrl={safeBandLogo(band.logo_url, process.env.NEXT_PUBLIC_SUPABASE_URL ?? "https://invalid.local")} />
              <span className="min-w-0 break-words font-semibold text-content [overflow-wrap:anywhere]">{band.name}</span>
            </span>
            <span className="shrink-0 text-sm text-content-muted">{role === "admin" ? "Administrador" : "Membro"} · Abrir painel</span>
          </Link>
        </li>)}
      </ul> : <section className="mt-7 rounded-2xl border border-dashed border-accent-border bg-surface p-6 sm:p-10">
        <h2 className="text-xl font-semibold text-content">Você ainda não participa de uma banda</h2>
        <p className="mt-3 text-sm leading-6 text-content-muted">Crie uma banda ou encontre uma para começar a colaborar.</p>
      </section>}
      <div className="mt-6 flex flex-wrap gap-3">
        <Link href="/bandas/nova" className="inline-flex min-h-11 items-center rounded-xl bg-primary px-5 py-3 text-sm font-semibold text-on-primary hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-focus">Criar banda</Link>
        <Link href="/descobrir" className="inline-flex min-h-11 items-center rounded-xl border border-accent-border px-5 py-3 text-sm font-semibold text-brand hover:bg-accent-soft focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-focus">Entrar em banda</Link>
      </div>
      </> : <>
        <header className="flex flex-wrap items-center gap-3">
          <button type="button" className={panelButton} onClick={() => {
            if (panel === "requests") navigate("bands", "trigger");
            else navigate("requests", panel);
          }}>← Voltar</button>
          <h1 tabIndex={-1} data-panel-focus="heading" className="scroll-mt-24 text-xl font-semibold text-content sm:text-2xl">
            {panel === "requests" ? "Solicitações" : requestOptions.find(option => option.panel === panel)?.title}
          </h1>
        </header>
        {panel === "requests" && <ul className="mt-3 grid gap-2 sm:grid-cols-2">
          {requestOptions.map(option => <li key={option.panel}>
            <button type="button" data-panel-focus={option.panel} onClick={() => navigate(option.panel)}
              className="flex min-h-11 w-full items-center justify-between gap-2 rounded-xl border border-nav-border bg-surface px-3 py-1.5 text-left text-sm font-semibold text-content hover:bg-accent-soft focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-focus">
              {option.title}
              <span aria-hidden="true" className="text-brand">›</span>
            </button>
          </li>)}
        </ul>}
      </>}
      {/* Keep started actions alive while the user returns to another panel. */}
      {visited.includes("sent") && <div hidden={panel !== "sent"}><BandEntryFlow /></div>}
      {visited.includes("received") && <div hidden={panel !== "received"}>
        <BandInvitations onAccepted={() => setRevision(value => value + 1)} />
      </div>}
    </div>
  </main>;
}
