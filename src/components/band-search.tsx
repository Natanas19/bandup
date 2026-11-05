"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import DisplayNameSettings from "@/components/display-name-settings";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { BAND_ENTRY_BACKEND_VALIDATED, createBandEntryService, entryError, type DiscoveredBand } from "@/lib/band-entry";
import { defaultEntryMessage, registerEntryRequest, searchBandNames } from "@/lib/band-search";
import { normalizeDisplayName } from "@/lib/display-name";

const button = "min-h-11 rounded-xl border border-accent-border px-4 py-3 text-sm font-semibold text-brand hover:bg-accent-soft focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-focus disabled:opacity-50";
const input = "min-h-11 w-full min-w-0 rounded-xl border border-outline bg-surface px-4 py-3 text-base text-content focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-focus";

export default function BandSearch() {
  const [name, setName] = useState<string | null>(null);
  const [accountReady, setAccountReady] = useState(false);
  const [accountFailed, setAccountFailed] = useState(false);
  const [query, setQuery] = useState("");
  const [bands, setBands] = useState<DiscoveredBand[]>([]);
  const [selected, setSelected] = useState<DiscoveredBand | null>(null);
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

  if (!BAND_ENTRY_BACKEND_VALIDATED) return null;

  async function search(after: string | null = null) {
    if (pending.current || !query.trim()) return;
    const ticket = ++generation.current;
    setLoading(true); setError(""); setSelected(null); setConfirming(false); setOutcome(null);
    try {
      const result = await searchBandNames(createBandEntryService(getSupabaseBrowserClient()), query, after);
      if (!live.current || ticket !== generation.current) return;
      setBands(previous => after ? [...previous, ...result.matches] : result.matches);
      setNext(result.next); setSearched(true);
    } catch (cause) {
      if (live.current && ticket === generation.current) { setBands([]); setNext(null); setError(entryError(cause).message); }
    } finally { if (live.current && ticket === generation.current) setLoading(false); }
  }
  async function send() {
    if (!confirming || !selected || !name || pending.current) return;
    pending.current = true; setSending(true); setError("");
    const ticket = generation.current;
    try {
      const result = await registerEntryRequest(createBandEntryService(getSupabaseBrowserClient()), selected.band_id, name);
      if (live.current && ticket === generation.current) { setOutcome(result); setConfirming(false); }
    } catch (cause) { if (live.current && ticket === generation.current) setError(entryError(cause).message); }
    finally { pending.current = false; if (live.current) setSending(false); }
  }

  return <section className="mt-7 min-w-0 space-y-5 rounded-2xl border border-nav-border bg-surface p-4 sm:p-6" aria-label="Buscar banda pelo nome">
    <h2 className="text-xl font-semibold text-content">Encontre uma banda pelo nome</h2>
    {error && <p role="alert" className="text-sm leading-6 text-danger">{error}</p>}
    <form className="space-y-3" onSubmit={event => { event.preventDefault(); void search(); }}>
      <label htmlFor="band-search-name" className="block text-sm font-semibold text-content">Nome da banda</label>
      <input id="band-search-name" type="search" required maxLength={100} autoComplete="off" className={input} value={query} disabled={sending}
        onChange={event => {
          generation.current++; setQuery(event.target.value); setBands([]); setNext(null); setSearched(false);
          setSelected(null); setConfirming(false); setOutcome(null); setError(""); setLoading(false);
        }} />
      <button className={button} disabled={!query.trim() || loading || sending}>{loading ? "Buscando..." : "Buscar bandas"}</button>
    </form>
    {!searched && !loading && <p role="status" className="text-sm text-content-muted">Digite o nome de uma banda para começar. Nenhuma banda é listada antes da sua busca.</p>}
    {loading && <p role="status" className="text-sm text-content-muted">Pesquisando bandas que aceitam pedidos...</p>}
    {searched && !loading && !bands.length && <p role="status" className="text-sm text-content-muted">{next ? "Nenhuma correspondência neste trecho da busca. Continue pesquisando mais bandas." : "Nenhuma banda encontrada para esse nome."}</p>}
    {bands.map(band => <article key={band.band_id} className="space-y-3 rounded-xl border border-nav-border p-4">
      <h3 className="break-words font-semibold text-content [overflow-wrap:anywhere]">{band.display_name}</h3>
      <p className="break-words text-sm text-content-muted">{band.summary}</p>
      <button type="button" className={button} disabled={sending || loading} aria-pressed={selected?.band_id === band.band_id}
        onClick={() => { setSelected(band); setMessage(name ? defaultEntryMessage(name) : ""); setConfirming(false); setOutcome(null); setError(""); }}>Selecionar banda</button>
    </article>)}
    {next && <button type="button" className={button} disabled={loading || sending} onClick={() => void search(next)}>Pesquisar mais bandas</button>}
    {!accountReady && !accountFailed && <p role="status" className="text-sm text-content-muted">Verificando sua conta para solicitar entrada...</p>}
    {accountFailed && <Link href="/login" className={`${button} inline-flex items-center`}>Ir para o login</Link>}
    {accountReady && !name && <DisplayNameSettings onSaved={saved => { setName(saved); setMessage(defaultEntryMessage(saved)); }} />}
    {selected && name && !outcome && <form className="space-y-3 border-t border-nav-border pt-5" onSubmit={event => { event.preventDefault(); setConfirming(true); }}>
      <p className="break-words text-sm font-semibold text-content">Banda selecionada: {selected.display_name}</p>
      <label htmlFor="entry-draft" className="block text-sm font-semibold text-content">Mensagem de apresentação · rascunho não enviado</label>
      <textarea id="entry-draft" className={input} rows={4} maxLength={1000} value={message} disabled={sending} onChange={event => { setMessage(event.target.value); setConfirming(false); }} />
      <p className="text-sm leading-6 text-content-muted">O pedido registra somente seu nome de exibição. Este ambiente ainda não armazena nem envia a mensagem acima ao administrador. O rascunho será perdido ao sair.</p>
      <button className={button} disabled={sending || loading}>Revisar solicitação</button>
    </form>}
    {confirming && !outcome && <div role="group" aria-labelledby="entry-confirm-title" className="space-y-3 rounded-xl border border-accent-border bg-accent-soft p-4">
      <h3 id="entry-confirm-title" className="font-semibold text-content">Confirmar solicitação para {selected?.display_name}?</h3>
      <p className="text-sm text-content-muted">Seu nome será registrado como {name}. A mensagem não será enviada. A entrada depende de aprovação.</p>
      <div className="flex flex-wrap gap-3">
        <button type="button" className={button} disabled={sending} onClick={() => void send()}>{sending ? "Registrando..." : "Confirmar pedido sem mensagem"}</button>
        <button type="button" className={button} disabled={sending} onClick={() => setConfirming(false)}>Voltar</button>
      </div>
    </div>}
    {outcome && <div className="space-y-3 rounded-xl bg-accent-soft p-4">
      <p role="status" className="text-sm leading-6 text-content">{outcome === "pending" ? "Você já tem uma solicitação pendente para esta banda." : "Solicitação registrada no sistema. Aguarde a decisão de um administrador."} A mensagem de apresentação não foi enviada.</p>
      <Link href="/meu-perfil" className={`${button} inline-flex items-center`}>Ir para Meu Perfil</Link>
    </div>}
  </section>;
}
