"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { loadPersonalOverview, type PersonalOverview } from "@/lib/personal-profile";
import ProfileAvatar from "@/components/profile-avatar";
import { safeBandLogo } from "@/lib/public-band-data";

export default function PersonalBandsPage() {
  const [overview, setOverview] = useState<PersonalOverview | null>(null);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
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

  return <main className="min-w-0 flex-1 px-4 py-6 sm:px-6 sm:py-8 lg:px-10 lg:py-10">
    <div className="mx-auto w-full max-w-4xl">
      <header>
        <p className="text-xs font-semibold uppercase tracking-widest text-accent">Meu Painel</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-content sm:text-4xl">Minhas Bandas</h1>
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
    </div>
  </main>;
}
