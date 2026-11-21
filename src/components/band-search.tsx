"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import DisplayNameSettings from "@/components/display-name-settings";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { BAND_ENTRY_BACKEND_VALIDATED, createBandEntryService, entryError, type DiscoveredBand } from "@/lib/band-entry";
import { defaultEntryMessage, registerEntryRequest, searchBandNames } from "@/lib/band-search";
import { normalizeDisplayName } from "@/lib/display-name";
import ProfileAvatar from "@/components/profile-avatar";
import { safeBandLogo } from "@/lib/public-band-data";

const button = "min-h-11 rounded-xl border border-accent-border px-4 py-3 text-sm font-semibold text-brand hover:bg-accent-soft focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-focus disabled:opacity-50";
const input = "min-h-11 w-full min-w-0 rounded-xl border border-outline bg-surface px-4 py-3 text-base text-content focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-focus";

export default function BandSearch({ onRequestsChanged, headerFormId }: {
  onRequestsChanged?: () => void;
  headerFormId?: string;
} = {}) {
  const compact = headerFormId !== undefined;
  const [name, setName] = useState<string | null>(null);
  const [accountReady, setAccountReady] = useState(false);
  const [accountFailed, setAccountFailed] = useState(false);
  const [query, setQuery] = useState("");
  const [bands, setBands] = useState<DiscoveredBand[]>([]);
  const [selected, setSelected] = useState<DiscoveredBand | null>(null);
  const [entryEligibility, setEntryEligibility] = useState<"checking" | "member" | "pending" | "eligible" | "error" | null>(null);
  const [message, setMessage] = useState("");
  const [next, setNext] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [outcome, setOutcome] = useState<"created" | "pending" | null>(null);
  const [error, setError] = useState("");
  const live = useRef(false);
  const generation = useRef(0);
  const pending = useRef(false);
  const checkingEligibility = useRef(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const draft = useRef<HTMLTextAreaElement>(null);
  const opener = useRef<HTMLButtonElement>(null);
  const success = useRef<HTMLParagraphElement>(null);
  const uncertainBands = useRef(new Set<string>());
  const [uncertain, setUncertain] = useState(false);
  useEffect(() => {
    live.current = true;
    const tracker = generation;
    if (BAND_ENTRY_BACKEND_VALIDATED) {
      void (async () => {
        try {
          const { data, error } = await getSupabaseBrowserClient().auth.getUser();
          if (!live.current) return;
          if (error || !data.user) throw new Error("auth");
          setName(normalizeDisplayName(data.user.user_metadata?.display_name)); setAccountReady(true);
        } catch { if (live.current) { setAccountFailed(true); setError("Não foi possível carregar sua conta. Atualize a página ou acesse o login."); } }
      })();
    }
    return () => { live.current = false; tracker.current++; };
  }, []);

  useEffect(() => {
    const modal = dialog.current;
    if (confirming && modal && !modal.open) {
      modal.showModal();
      draft.current?.focus();
    } else if (!confirming && modal?.open) {
      modal.close();
      (success.current ?? opener.current)?.focus();
    }
  }, [confirming]);

  if (!BAND_ENTRY_BACKEND_VALIDATED) return <section className={compact ? "min-w-0" : "mt-7 min-w-0 space-y-3 rounded-2xl border border-nav-border bg-surface p-4 sm:p-6"} aria-label="Buscar banda pelo nome ou ID">
    <h2 className="text-xl font-semibold text-content">Busca de bandas</h2>
    <p role="status" className="text-sm leading-6 text-content-muted">{compact ? "A busca de bandas está indisponível." : "A busca e os pedidos de entrada precisam da configuração Supabase deste projeto. Configure NEXT_PUBLIC_SUPABASE_URL e NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY para habilitar esta tela."}</p>
  </section>;

  function resetSearch(term: string) {
    generation.current++; setQuery(term); setBands([]); setNext(null); setSearched(false);
    setSelected(null); setConfirming(false); setOutcome(null); setError(""); setLoading(false);
    setEntryEligibility(null);
  }

  async function search(after: string | null = null, term = query) {
    if (pending.current || checkingEligibility.current || !term.trim()) return;
    const ticket = ++generation.current;
    setLoading(true); setError(""); setSelected(null); setConfirming(false); setOutcome(null);
    try {
      const result = await searchBandNames(createBandEntryService(getSupabaseBrowserClient()), term, after);
      if (!live.current || ticket !== generation.current) return;
      setBands(previous => after ? [...previous, ...result.matches] : result.matches);
      setNext(result.next); setSearched(true);
    } catch (cause) {
      if (live.current && ticket === generation.current) { setBands([]); setNext(null); setError(entryError(cause).message); }
    } finally { if (live.current && ticket === generation.current) setLoading(false); }
  }
  async function openEntryDialog(band: DiscoveredBand) {
    if (pending.current || checkingEligibility.current || !accountReady || !name) return;
    checkingEligibility.current = true;
    const ticket = ++generation.current;
    setSelected(band); setMessage(name ? defaultEntryMessage(name) : "");
    setConfirming(false); setOutcome(null); setError(""); setEntryEligibility("checking");
    setUncertain(uncertainBands.current.has(band.band_id));
    try {
      const eligibility = await createBandEntryService(getSupabaseBrowserClient()).entryEligibility(band.band_id);
      if (live.current && ticket === generation.current) {
        setEntryEligibility(eligibility);
        if (eligibility === "eligible") setConfirming(true);
      }
    } catch (cause) {
      if (live.current && ticket === generation.current) {
        setEntryEligibility("error"); setError(entryError(cause).message);
      }
    } finally { checkingEligibility.current = false; }
  }
  async function send() {
    if (!confirming || !selected || !name || entryEligibility !== "eligible" || pending.current) return;
    pending.current = true; setSending(true); setError("");
    const ticket = generation.current;
    try {
      const api = createBandEntryService(getSupabaseBrowserClient());
      let result: "created" | "pending";
      if (uncertainBands.current.has(selected.band_id)) {
        if (!await api.pendingRequest(selected.band_id)) throw new Error("Unconfirmed request");
        result = "pending";
      } else {
        uncertainBands.current.add(selected.band_id);
        result = await registerEntryRequest(api, selected.band_id, name);
      }
      uncertainBands.current.delete(selected.band_id);
      if (live.current && ticket === generation.current) { setOutcome(result); setEntryEligibility("pending"); setConfirming(false); }
    } catch (cause) {
      if (live.current && ticket === generation.current) {
        setUncertain(true);
        setError(`${entryError(cause).message} O resultado não foi confirmado. Verifique o pedido antes de tentar novamente; nenhuma nova solicitação será enviada nesta tentativa.`);
      }
    }
    finally {
      pending.current = false;
      if (live.current) {
        setSending(false);
        if (ticket === generation.current) onRequestsChanged?.();
      }
    }
  }

  return <section className={compact ? "min-w-0 space-y-3" : "mt-7 min-w-0 space-y-5 rounded-2xl border border-nav-border bg-surface p-4 sm:p-6"} aria-label="Buscar banda pelo nome ou ID">
    {!compact && <h2 className="text-xl font-semibold text-content">Encontre uma banda pelo nome ou ID</h2>}
    {error && <p role="alert" className="text-sm leading-6 text-danger">{error}</p>}
    {compact ? <form id={headerFormId} onSubmit={event => {
      event.preventDefault();
      const term = new FormData(event.currentTarget).get("band-query");
      if (typeof term !== "string" || !term.trim() || loading || pending.current || checkingEligibility.current) return;
      resetSearch(term);
      void search(null, term);
    }} /> : <form className="space-y-3" onSubmit={event => { event.preventDefault(); void search(); }}>
      <label htmlFor="band-search-name" className="block text-sm font-semibold text-content">Nome ou ID da banda</label>
      <input id="band-search-name" type="search" required maxLength={100} autoComplete="off" className={input} value={query} disabled={sending}
        onChange={event => resetSearch(event.target.value)} />
      <button className={button} disabled={!query.trim() || loading || sending}>{loading ? "Buscando..." : "Buscar bandas"}</button>
    </form>}
    {!searched && !loading && <p role="status" className="text-sm text-content-muted">Digite o nome ou ID de uma banda para começar. Nenhuma banda é listada antes da sua busca.</p>}
    {loading && <p role="status" className="text-sm text-content-muted">Pesquisando bandas cadastradas...</p>}
    {searched && !loading && !bands.length && <p role="status" className="text-sm text-content-muted">{next ? "Nenhuma correspondência neste trecho da busca. Continue pesquisando mais bandas." : "Nenhuma banda encontrada para essa pesquisa."}</p>}
    {bands.map(band => <article key={band.band_id} className={compact ? "flex min-w-0 flex-wrap items-center justify-between gap-2 rounded-xl border border-nav-border bg-surface p-2.5" : "space-y-3 rounded-xl border border-nav-border p-4"}>
      <div className="flex min-w-0 items-center gap-3">
        <ProfileAvatar name={band.name} imageUrl={safeBandLogo(band.logo_url, process.env.NEXT_PUBLIC_SUPABASE_URL ?? "https://invalid.local")} />
        <div className="min-w-0">
          <h3 className="break-words font-semibold text-content [overflow-wrap:anywhere]">{band.name}</h3>
          {compact && <p className="text-xs text-content-muted">Banda</p>}
        </div>
      </div>
      <button ref={selected?.band_id === band.band_id ? opener : undefined} type="button" className={button}
        aria-label={`Solicitar entrada em ${band.name}`}
        disabled={sending || loading || !accountReady || !name || entryEligibility === "checking"
          || (selected?.band_id === band.band_id && (entryEligibility === "member" || entryEligibility === "pending"))}
        onClick={() => void openEntryDialog(band)}>
        {selected?.band_id === band.band_id && entryEligibility === "checking" ? "Verificando..."
          : selected?.band_id === band.band_id && entryEligibility === "member" ? "Você já é integrante"
          : selected?.band_id === band.band_id && entryEligibility === "pending" ? "Pedido pendente" : "Solicitar entrada"}
      </button>
    </article>)}
    {next && <button type="button" className={button} disabled={loading || sending} onClick={() => void search(next)}>Pesquisar mais bandas</button>}
    {!accountReady && !accountFailed && <p role="status" className="text-sm text-content-muted">Verificando sua conta para solicitar entrada...</p>}
    {accountFailed && <Link href="/login" className={`${button} inline-flex items-center`}>Ir para o login</Link>}
    {accountReady && !name && <DisplayNameSettings onSaved={saved => { setName(saved); setMessage(defaultEntryMessage(saved)); }} />}
    {selected && entryEligibility === "checking" && <p role="status" className="text-sm text-content-muted">Verificando sua participação e solicitações para esta banda...</p>}
    {selected && entryEligibility === "member" && <p role="status" className="rounded-xl bg-accent-soft p-4 text-sm text-content">Você já faz parte desta banda. Não é necessário solicitar entrada.</p>}
    {selected && entryEligibility === "pending" && <p role="status" className="rounded-xl bg-accent-soft p-4 text-sm text-content">Você já tem uma solicitação pendente para esta banda. Acompanhe o status no Meu Painel.</p>}
    {selected && entryEligibility === "member" && <Link href={`/bandas/${selected.band_id}`} className={`${button} inline-flex items-center`}>Acessar banda</Link>}
    <dialog ref={dialog} aria-labelledby="entry-confirm-title" aria-describedby="entry-confirm-description" aria-busy={sending}
      onCancel={event => { event.preventDefault(); if (!pending.current) setConfirming(false); }}
      className="m-auto max-h-[calc(100dvh_-_2rem)] w-[calc(100%_-_2rem)] max-w-lg overflow-y-auto overscroll-contain rounded-2xl border border-accent-border bg-surface p-5 text-content shadow-xl backdrop:bg-shadow-tint/60 sm:p-6">
      {confirming && <div className="space-y-4">
      <h3 id="entry-confirm-title" className="break-words text-lg font-semibold text-content">Confirmar solicitação para {selected?.name}?</h3>
      <p id="entry-confirm-description" className="text-sm text-content-muted">Seu nome será registrado como {name}. A mensagem não será enviada. A entrada depende de aprovação.</p>
      <label htmlFor="entry-draft" className="block text-sm font-semibold text-content">Mensagem de apresentação · rascunho não enviado</label>
      <textarea ref={draft} id="entry-draft" className={input} rows={4} maxLength={1000} value={message} disabled={sending} onChange={event => setMessage(event.target.value)} />
      <p className="text-sm leading-6 text-content-muted">O pedido registra somente seu nome de exibição. Este ambiente ainda não armazena nem envia a mensagem acima ao administrador. O rascunho será perdido ao sair.</p>
      {error && <p role="alert" className="text-sm leading-6 text-danger">{error}</p>}
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
        <button type="button" className={button} disabled={sending} onClick={() => void send()}>{sending ? "Registrando..." : uncertain ? "Verificar pedido" : "Confirmar pedido sem mensagem"}</button>
        <button type="button" className={button} disabled={sending} onClick={() => { if (!pending.current) setConfirming(false); }}>Cancelar</button>
      </div>
      </div>}
    </dialog>
    {outcome && <div className="space-y-3 rounded-xl bg-accent-soft p-4">
      <p ref={success} tabIndex={-1} role="status" className="text-sm leading-6 text-content">{outcome === "pending" ? "Você já tem uma solicitação pendente para esta banda." : "Solicitação registrada no sistema. Aguarde a decisão de um administrador."} A mensagem de apresentação não foi enviada.</p>
      <Link href="/dashboard" className={`${button} inline-flex items-center`}>Ir para Meu Painel</Link>
    </div>}
  </section>;
}
