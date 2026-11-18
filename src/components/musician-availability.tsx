"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { MUSICIAN_AVAILABILITY_ENABLED, loadMusicianAvailability, saveMusicianAvailability } from "@/lib/musician-availability";

export default function MusicianAvailability({ userId }: { userId: string }) {
  const [available, setAvailable] = useState(false);
  const [phase, setPhase] = useState<"loading" | "ready" | "saving" | "error" | "blocked">("loading");
  const [message, setMessage] = useState("");
  const mounted = useRef(false);
  const pending = useRef(false);
  const operation = useRef<AbortController | null>(null);

  const perform = useCallback(async (value?: boolean) => {
    if (!MUSICIAN_AVAILABILITY_ENABLED || !mounted.current || pending.current) return;
    pending.current = true;
    const controller = new AbortController(); operation.current = controller;
    setPhase(value === undefined ? "loading" : "saving"); setMessage("");
    const timer = window.setTimeout(() => controller.abort(), 15000);
    try {
      const client = getSupabaseBrowserClient();
      const result = value === undefined
        ? await loadMusicianAvailability(client, userId, controller.signal)
        : await saveMusicianAvailability(client, userId, value, controller.signal);
      if (!mounted.current || operation.current !== controller || controller.signal.aborted) return;
      setAvailable(result); setPhase("ready");
      if (value !== undefined) setMessage(result ? "Disponibilidade ativada." : "Disponibilidade desativada.");
    } catch {
      if (mounted.current && operation.current === controller) {
        setPhase("error");
        setMessage("Não foi possível confirmar sua disponibilidade. Verifique novamente antes de alterar.");
      }
    } finally {
      window.clearTimeout(timer);
      if (operation.current === controller) { pending.current = false; operation.current = null; }
    }
  }, [userId]);

  useEffect(() => {
    if (!MUSICIAN_AVAILABILITY_ENABLED) return;
    mounted.current = true;
    let unsubscribe = () => {};
    try {
      const client = getSupabaseBrowserClient();
      const { data } = client.auth.onAuthStateChange((event, session) => {
        if (event === "SIGNED_OUT" || (session && session.user.id !== userId)) {
          mounted.current = false; operation.current?.abort(); operation.current = null;
          pending.current = false; setAvailable(false); setPhase("blocked");
          setMessage("Sua sessão mudou. Recarregue o perfil para continuar.");
        }
      });
      unsubscribe = () => data.subscription.unsubscribe();
      void perform();
    } catch {
      setPhase("error"); setMessage("Não foi possível carregar sua disponibilidade. Tente novamente.");
    }
    return () => {
      mounted.current = false; operation.current?.abort(); operation.current = null;
      pending.current = false; unsubscribe();
    };
  }, [perform, userId]);

  const busy = MUSICIAN_AVAILABILITY_ENABLED && (phase === "loading" || phase === "saving");
  return <section aria-labelledby="musician-availability-title" aria-busy={busy}
    className="mt-6 space-y-3 rounded-panel border border-outline bg-surface p-5 sm:p-6">
    <label className="flex min-h-11 cursor-pointer items-center justify-between gap-4">
      <span id="musician-availability-title" className="text-sm font-semibold text-content">Disponível para bandas</span>
      <input type="checkbox" role="switch" checked={available}
        aria-describedby="musician-availability-help" disabled={!MUSICIAN_AVAILABILITY_ENABLED || phase !== "ready"}
        onChange={event => void perform(event.target.checked)}
        className="h-5 w-5 shrink-0 accent-primary focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-focus disabled:cursor-not-allowed disabled:opacity-50" />
    </label>
    <p id="musician-availability-help" className="text-sm leading-6 text-content-muted">
      Seu nome e foto poderão aparecer na busca de músicos quando ela estiver disponível. Você pode desativar esta opção a qualquer momento.
    </p>
    {!MUSICIAN_AVAILABILITY_ENABLED && <p role="status" className="text-sm text-content-muted">Disponibilidade para bandas ainda não está disponível neste ambiente.</p>}
    {busy && <p role="status" className="text-sm text-content-muted">{phase === "saving" ? "Salvando disponibilidade..." : "Carregando disponibilidade..."}</p>}
    {message && <p role={phase === "error" || phase === "blocked" ? "alert" : "status"}
      className={`text-sm ${phase === "error" || phase === "blocked" ? "text-danger" : "text-content-muted"}`}>{message}</p>}
    {MUSICIAN_AVAILABILITY_ENABLED && phase === "error" && <button type="button" onClick={() => void perform()}
      className="min-h-11 rounded-control border border-accent-border px-4 py-2 text-sm font-semibold text-brand focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-focus">Verificar disponibilidade</button>}
  </section>;
}
