"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { prepareOnboarding } from "@/lib/onboarding";

export default function WelcomeOnboarding({ userId, children }: { userId: string; children: ReactNode }) {
  const [phase, setPhase] = useState<"loading" | "welcome" | "done" | "error">("loading");
  const [revision, setRevision] = useState(0);
  const attempt = useRef<{ revision: number; promise: Promise<boolean> } | null>(null);
  useEffect(() => {
    let active = true;
    setPhase("loading");
    if (!attempt.current || attempt.current.revision !== revision) {
      attempt.current = { revision, promise: (async () => prepareOnboarding(getSupabaseBrowserClient(), userId))() };
    }
    const timeout = window.setTimeout(() => { if (active) { active = false; setPhase("error"); } }, 15000);
    void attempt.current.promise.then(show => {
      if (active) { window.clearTimeout(timeout); setPhase(show ? "welcome" : "done"); }
    }).catch(() => { if (active) { window.clearTimeout(timeout); setPhase("error"); } });
    return () => { active = false; window.clearTimeout(timeout); };
  }, [userId, revision]);
  if (phase === "done") return children;
  return <main className="flex min-w-0 flex-1 items-center justify-center px-4 py-8 sm:px-8 sm:py-12">
    <section aria-labelledby="welcome-title" aria-busy={phase === "loading"} className="w-full max-w-2xl rounded-3xl border border-accent-border bg-surface p-5 shadow-app-dashboard sm:p-10">
      <p className="text-sm font-semibold tracking-widest text-accent">BandUp</p>
      <h1 id="welcome-title" className="mt-3 text-3xl font-semibold text-content">Boas-vindas ao BandUp!</h1>
      {phase === "loading" ? <p role="status" className="mt-5 text-sm text-content-muted">Preparando seu primeiro acesso...</p> : phase === "error" ? <>
        <p role="alert" className="mt-5 text-sm leading-6 text-danger">Não foi possível salvar sua preferência de boas-vindas. Tente novamente. Seus recursos continuam disponíveis no Meu Painel.</p>
        <button type="button" onClick={() => setRevision(value => value + 1)} className="mt-5 min-h-11 rounded-xl border border-accent-border px-5 py-3 font-semibold text-brand">Tentar novamente</button>
        <Link href="/dashboard" className="mt-4 flex min-h-11 items-center text-sm font-semibold text-accent underline">Ir para Meu Painel</Link>
        <button type="button" onClick={() => setPhase("done")} className="mt-3 min-h-11 rounded-xl px-5 py-3 text-sm font-semibold text-accent underline">Ver minhas bandas</button>
      </> : <>
        <p className="mt-4 text-sm leading-6 text-content-muted">Sua conta pessoal acompanha você em todas as bandas. Como deseja começar?</p>
        <div className="mt-7 grid gap-3 sm:grid-cols-2">
          <Link href="/bandas/nova" className="flex min-h-11 items-center justify-center rounded-xl bg-primary px-5 py-4 font-semibold text-on-primary hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-focus">Criar banda</Link>
          <Link href="/descobrir" className="flex min-h-11 items-center justify-center rounded-xl border border-accent-border px-5 py-4 font-semibold text-brand hover:bg-accent-soft focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-focus">Encontrar banda</Link>
        </div>
        <Link href="/dashboard" className="mt-4 flex min-h-11 items-center justify-center rounded-xl px-5 py-3 text-sm font-semibold text-content-muted hover:bg-accent-soft focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-focus">Pular por enquanto</Link>
        <button type="button" onClick={() => setPhase("done")} className="mt-2 min-h-11 w-full rounded-xl px-5 py-3 text-sm font-semibold text-accent underline focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-focus">Ver minhas bandas</button>
      </>}
    </section>
  </main>;
}
