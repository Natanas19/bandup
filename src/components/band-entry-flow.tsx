"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import BandEntryPanel from "@/components/band-entry-panel";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { BAND_ENTRY_BACKEND_VALIDATED, createBandEntryService, entryError,
  type BandEntryService, type EntryRequest } from "@/lib/band-entry";

import { normalizeDisplayName } from "@/lib/display-name";
import ProfileAvatar from "@/components/profile-avatar";
import { safeBandLogo } from "@/lib/public-band-data";

const button = "min-h-11 rounded-xl border border-accent-border px-4 py-2 text-sm font-semibold text-accent disabled:cursor-not-allowed disabled:opacity-50";
const statusLabels = { pending: "Pendente", approved: "Aprovado", rejected: "Recusado", cancelled: "Cancelado" };
const supabaseOrigin = typeof process !== "undefined" ? process.env.NEXT_PUBLIC_SUPABASE_URL : undefined;

function EntryFlow({ bandId, onMembersChanged }: { bandId?: string; onMembersChanged?: () => void }) {
  const admin = !!bandId;
  const [phase, setPhase] = useState<"loading" | "ready" | "error" | "unavailable" | "forbidden">(
    BAND_ENTRY_BACKEND_VALIDATED ? "loading" : "unavailable");
  const [requests, setRequests] = useState<EntryRequest[]>([]);
  const [offset, setOffset] = useState(0);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ error: boolean; text: string } | null>(null);
  const service = useRef<BandEntryService | null>(null);
  const live = useRef(false);
  const generation = useRef(0);
  const actionPending = useRef(false);
  const [decision, setDecision] = useState<{ row: EntryRequest; status: "approved" | "rejected" } | null>(null);
  const [avatars, setAvatars] = useState<Map<string, string | null>>(new Map());

  const load = useCallback(async () => {
    if (!BAND_ENTRY_BACKEND_VALIDATED) return;
    const ticket = ++generation.current;
    setPhase("loading");
    setAvatars(new Map());
    try {
      const api = service.current ??= createBandEntryService(getSupabaseBrowserClient());
      const rows = bandId ? await api.adminRequests(bandId, offset, true) : await api.ownRequests(offset);
      if (!live.current || ticket !== generation.current) return;
      setRequests(rows.filter(row => row.status === "pending"));
      setDecision(null);
      setPhase("ready");
      if (bandId) {
        const ids = rows.filter(row => row.band_id === bandId && row.status === "pending").slice(0, 20).map(row => row.id);
        if (ids.length) {
          // Optional presentation only: never delay the list, pagination or actions.
          void Promise.resolve().then(() => api.pendingRequestAvatars(bandId, ids)).then(images => {
            if (live.current && ticket === generation.current) setAvatars(images);
          }).catch(() => { /* Keep initials and the actionable request list. */ });
        }
      }
    } catch (error) {
      if (!live.current || ticket !== generation.current) return;
      const failure = entryError(error);
      setRequests([]);
      setDecision(null);
      setFeedback({ error: true, text: failure.message });
      setPhase(failure.code === "blocked" ? "unavailable" : failure.code === "42501" ? "forbidden" : "error");
      throw failure;
    }
  }, [bandId, offset]);

  useEffect(() => {
    const tracker = generation;
    live.current = true;
    void load().catch(() => {});
    return () => { live.current = false; tracker.current++; };
  }, [load]);

  async function mutate(operation: (api: BandEntryService) => Promise<string>) {
    if (!BAND_ENTRY_BACKEND_VALIDATED || actionPending.current || !service.current) return;
    actionPending.current = true; setBusy(true); setFeedback(null);
    try {
      const message = await operation(service.current);
      if (!live.current) return;
      await load();
      if (live.current) setFeedback({ error: false, text: message });
    } catch (error) {
      if (!live.current) return;
      const failure = entryError(error);
      // A lost response may hide a committed write. Refresh, never retry mutation.
      try { await load(); } catch { /* load already conceals denied/stale data */ }
      if (live.current) setFeedback({ error: true, text: failure.message });
    } finally {
      actionPending.current = false;
      if (live.current) setBusy(false);
    }
  }

  if (phase !== "ready") return <div>
    <BandEntryPanel admin={admin} state={phase === "forbidden" ? "error" : phase} />
    {phase === "unavailable" && <p className="mt-4 text-sm text-content-muted">O acompanhamento e o cancelamento de pedidos também aguardam a validação do backend.</p>}
    {feedback && <p role="alert" className="mt-4 text-sm text-danger">{feedback.text}</p>}
    {(phase === "error" || phase === "forbidden") && <button className={`${button} mt-4`} disabled={busy}
      onClick={() => { setFeedback(null); void load().catch(() => {}); }}>Atualizar acesso</button>}
  </div>;

  async function decide(row: EntryRequest, decision: "approved" | "rejected") {
    if (!bandId) return;
    await mutate(async api => {
      await api.decide(bandId, row.id, decision);
      const confirmed = await api.getRequest(row.id, bandId);
      if (confirmed?.status !== decision) throw entryError(null);
      if (decision === "approved" && live.current) onMembersChanged?.();
      return decision === "approved" ? "Entrada aprovada. O músico entrou como membro." : "Pedido recusado.";
    });
  }

  return <section className="mt-7 space-y-6" aria-label={admin ? "Gerenciar solicitações" : "Descoberta e meus pedidos"} aria-busy={busy}>
    {feedback && <p role={feedback.error ? "alert" : "status"} className={`rounded-xl border p-4 text-sm ${feedback.error ? "text-danger" : "text-content"}`}>{feedback.text}</p>}
    <div className="space-y-4 rounded-2xl border border-nav-border bg-surface p-5">
      <h2 className="text-lg font-semibold text-content">{admin ? "Pedidos recebidos" : "Meus pedidos"}</h2>
      {admin && <p className="text-sm text-content-muted">Somente solicitações pendentes são exibidas.</p>}
      {!requests.length && <p role="status" className="text-sm text-content-muted">{admin ? "Nenhum pedido nesta página." : offset === 0 ? "Você não tem pedidos pendentes." : "Nenhum pedido pendente nesta página."}</p>}
      {requests.map(row => <article key={row.id} className="space-y-3 rounded-xl border border-nav-border p-4">
        {admin ? <div className="flex min-w-0 items-center gap-3">
          <ProfileAvatar name={normalizeDisplayName(row.applicant_name) ?? "Solicitante sem nome"}
            imageUrl={safeBandLogo(avatars.get(row.id) ?? null, supabaseOrigin ?? "https://invalid.local")} />
          <p className="min-w-0 break-words font-semibold text-content [overflow-wrap:anywhere]">{normalizeDisplayName(row.applicant_name) ?? "Solicitante sem nome"}</p>
        </div> : <p className="break-words font-semibold text-content">Banda: {row.band_id}</p>}
        {!admin && <p className="break-all text-xs text-content-muted">Pedido {row.id}</p>}
        <p className="text-sm text-content">{statusLabels[row.status]}</p>
        <time dateTime={row.requested_at} className="text-xs text-content-muted">{new Date(row.requested_at).toLocaleString("pt-BR")}</time>
        {row.status === "pending" && <div className="flex flex-col gap-3 sm:flex-row">{admin ? <>
          <button className={button} disabled={busy} onClick={() => setDecision({ row, status: "approved" })}>Aprovar entrada</button>
          <button className={button} disabled={busy} onClick={() => setDecision({ row, status: "rejected" })}>Recusar pedido</button>
        </> : <button className={button} disabled={busy} onClick={() => void mutate(async api => {
          await api.cancel(row.id);
          if ((await api.getRequest(row.id))?.status !== "cancelled") throw entryError(null);
          return "Pedido cancelado.";
        })}>Cancelar pedido</button>}</div>}
        {decision?.row.id === row.id && <div role="group" aria-labelledby="entry-decision-title" className="space-y-3 rounded-xl border border-accent-border bg-accent-soft p-4">
          <h2 id="entry-decision-title" className="font-semibold text-content">{decision.status === "approved" ? "Confirmar aprovação?" : "Confirmar recusa?"}</h2>
          <p className="break-words text-sm text-content-muted">{normalizeDisplayName(decision.row.applicant_name) ?? "Solicitante sem nome"}. {decision.status === "approved" ? "A pessoa passará a integrar esta banda como membro." : "A pessoa não entrará na banda por este pedido."}</p>
          <div className="flex flex-wrap gap-3">
            <button type="button" className={button} disabled={busy} onClick={() => void decide(decision.row, decision.status)}>{busy ? "Processando..." : decision.status === "approved" ? "Confirmar aprovação" : "Confirmar recusa"}</button>
            <button type="button" className={button} disabled={busy} onClick={() => setDecision(null)}>Voltar sem decidir</button>
          </div>
        </div>}
        {!admin && row.status === "approved" && <Link className={button} href={`/bandas/${row.band_id}`}>Abrir banda</Link>}
      </article>)}
      <div className="flex flex-wrap gap-3"><button className={button} disabled={busy || offset === 0} onClick={() => setOffset(Math.max(0, offset - 20))}>Pedidos anteriores</button>
        <button className={button} disabled={busy || requests.length < 20} onClick={() => setOffset(offset + 20)}>Próximos pedidos</button></div>
    </div>
  </section>;
}

export default function BandEntryFlow({ bandId, onMembersChanged }: { bandId?: string; onMembersChanged?: () => void }) {
  return <EntryFlow key={bandId ?? "applicant"} bandId={bandId} onMembersChanged={onMembersChanged} />;
}
