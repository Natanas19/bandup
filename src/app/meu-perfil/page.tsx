"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { loadPersonalOverview, type PersonalOverview } from "@/lib/personal-profile";

export default function PersonalProfilePage() {
  const [overview, setOverview] = useState<PersonalOverview | null>(null);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    setOverview(null); setError("");
    void (async () => {
      try {
        const data = await loadPersonalOverview(getSupabaseBrowserClient());
        if (active) setOverview(data);
      } catch {
        if (active) setError("Não foi possível carregar seu perfil e suas bandas. Tente novamente ou acesse o login.");
      }
    })();
    return () => { active = false; };
  }, [revision]);

  return <main className="min-w-0 flex-1 px-4 py-6 sm:px-6 sm:py-8 lg:px-10 lg:py-10">
    <div className="mx-auto w-full max-w-4xl">
      <header>
        <p className="text-xs font-semibold uppercase tracking-widest text-accent">Meu Perfil · Visão geral</p>
        <h1 className="mt-2 break-words text-3xl font-semibold tracking-tight text-content [overflow-wrap:anywhere] sm:text-4xl">{overview?.name ?? "Meu Perfil"}</h1>
        <p className="mt-3 text-sm leading-6 text-content-muted">Sua conta pessoal acompanha você em todas as suas bandas.</p>
      </header>
      {error ? <section className="mt-7 rounded-2xl border border-nav-border bg-surface p-5">
        <p role="alert" className="text-sm text-danger">{error}</p>
        <div className="mt-4 flex flex-wrap gap-3">
          <button type="button" onClick={() => setRevision(value => value + 1)} className="min-h-11 rounded-xl border border-accent-border px-4 py-3 text-sm font-semibold text-brand focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-focus">Tentar novamente</button>
          <Link href="/login" className="inline-flex min-h-11 items-center rounded-xl px-4 py-3 text-sm font-semibold text-brand underline focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-focus">Ir para o login</Link>
        </div>
      </section> : !overview ? <p role="status" className="mt-7 text-sm text-content-muted">Carregando seu perfil...</p> : <>
        {!overview.name && <p className="mt-5 text-sm text-content-muted">Seu nome de exibição ainda não foi informado.</p>}
        <section aria-label="Resumo pessoal" className="mt-7 rounded-2xl border border-nav-border bg-surface p-5 shadow-app-card">
          <h2 className="text-lg font-semibold text-content">Sua conta</h2>
          <dl className="mt-4 grid gap-4 sm:grid-cols-2">
            <div><dt className="text-sm text-content-muted">Confirmação de e-mail</dt><dd className="mt-1 font-semibold text-content">{overview.emailConfirmed ? "E-mail confirmado" : "Confirmação pendente"}</dd></div>
            <div><dt className="text-sm text-content-muted">Bandas das quais participa</dt><dd className="mt-1 font-semibold text-content">{overview.bands.length}</dd></div>
          </dl>
        </section>
        <section className="mt-7" aria-labelledby="personal-bands-title">
          <h2 id="personal-bands-title" className="text-xl font-semibold text-content">Suas bandas</h2>
          {overview.bands.length ? <ul className="mt-4 space-y-3">{overview.bands.map(({ band, role }) => <li key={band.id}>
            <Link href={`/bandas/${band.id}`} className="flex min-h-11 flex-col gap-3 rounded-2xl border border-nav-border bg-surface p-4 hover:bg-accent-soft focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-focus sm:flex-row sm:items-center sm:justify-between">
              <span className="min-w-0 break-words font-semibold text-content [overflow-wrap:anywhere]">{band.name}</span>
              <span className="shrink-0 text-sm text-content-muted">{role === "admin" ? "Administrador" : "Membro"} · Abrir workspace</span>
            </Link>
          </li>)}</ul> : <p className="mt-4 text-sm leading-6 text-content-muted">Você ainda não participa de nenhuma banda. Seu perfil pessoal já está disponível.</p>}
          <Link href="/dashboard" className="mt-5 inline-flex min-h-11 items-center rounded-xl border border-accent-border px-5 py-3 text-sm font-semibold text-brand hover:bg-accent-soft focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-focus">Minhas bandas · Encontrar ou criar uma banda</Link>
        </section>
      </>}
    </div>
  </main>;
}
