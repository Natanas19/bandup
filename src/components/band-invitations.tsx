"use client";

import { useEffect, useRef, useState } from "react";
import ProfileAvatar from "@/components/profile-avatar";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { BAND_INVITATIONS_ENABLED, createBandInvitationService, invitationError, invitationStatusLabel,
  INVITATION_PAGE_SIZE, type BandInvitation, type InvitationDecision, type InvitationBand, type InvitationMusician } from "@/lib/band-invitations";

const button = "min-h-11 max-w-full whitespace-normal rounded-xl border border-accent-border px-4 py-2 text-sm font-semibold text-brand hover:bg-accent-soft focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-focus disabled:opacity-50";
const panel = "mt-7 min-w-0 space-y-4 rounded-2xl border border-nav-border bg-surface p-4 [overflow-wrap:anywhere] sm:p-6";
type Feedback = { error: boolean; message: string } | null;
function Notice({ feedback }: { feedback: Feedback }) {
  return feedback && <p role={feedback.error ? "alert" : "status"} className={`text-sm ${feedback.error ? "text-danger" : "text-brand"}`}>{feedback.message}</p>;
}

export function BandInvitations({ bandId, onAccepted }: { bandId?: string; onAccepted?: () => void }) {
  if (!BAND_INVITATIONS_ENABLED) return null;
  return <InvitationList key={bandId ?? "received"} bandId={bandId} onAccepted={onAccepted} />;
}

function InvitationList({ bandId, onAccepted }: { bandId?: string; onAccepted?: () => void }) {
  const [api] = useState(() => createBandInvitationService(getSupabaseBrowserClient()));
  const [rows, setRows] = useState<BandInvitation[]>([]);
  const [offset, setOffset] = useState(0);
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [busy, setBusy] = useState(false);
  const [confirmation, setConfirmation] = useState<{ id: string; decision: InvitationDecision } | null>(null);
  const action = useRef(false);
  const live = useRef(false);
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  useEffect(() => {
    let active = true;
    setLoading(true); setFailed(false); setRows([]); setConfirmation(null);
    void api.list(bandId ?? null, offset).then(data => { if (active) setRows(data); }).catch(error => {
      if (active) { setFailed(true); setFeedback({ error: true, message: invitationError(error).message }); }
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [api, bandId, offset, revision]);

  async function decide() {
    if (!confirmation || action.current) return;
    action.current = true; setBusy(true); setFeedback(null);
    try {
      await api.decide(confirmation.id, confirmation.decision);
      if (!live.current) return;
      setFeedback({ error: false, message: confirmation.decision === "accepted" ? "Convite aceito. Você entrou na banda como membro." : "Convite recusado." });
      if (confirmation.decision === "accepted") onAccepted?.();
    } catch (error) {
      if (live.current) setFeedback({ error: true, message: invitationError(error).message });
    } finally {
      action.current = false;
      if (live.current) { setBusy(false); setConfirmation(null); setRevision(value => value + 1); }
    }
  }

  return <section className={panel} aria-label={bandId ? "Convites enviados" : "Convites recebidos"} aria-busy={loading || busy}>
    <h2 className="text-xl font-semibold text-content">{bandId ? "Convites enviados" : "Convites recebidos"}</h2>
    <Notice feedback={feedback} />
    {busy && <p role="status" className="text-sm text-content-muted">Processando convite...</p>}
    {loading ? <p role="status">Carregando convites...</p> : failed ? <p className="text-sm text-content-muted">A lista não está disponível agora.</p>
      : rows.length === 0 ? <p className="text-sm text-content-muted">Nenhum convite nesta página.</p>
        : <ul className="space-y-3">{rows.map(row => <li key={row.invitation_id} className="space-y-3 rounded-xl border border-nav-border p-4">
          <h3 className="break-words font-semibold text-content">{bandId ? "Convite para músico" : row.band_name}</h3>
          <p className="text-sm text-content-muted">{invitationStatusLabel[row.status]}</p>
          <time className="text-xs text-content-muted" dateTime={row.created_at}>{new Date(row.created_at).toLocaleString("pt-BR")}</time>
          {!bandId && row.status === "pending" && <div className="flex flex-wrap gap-3">
            <button className={button} aria-label={`Aceitar convite de ${row.band_name}`} disabled={busy} onClick={() => setConfirmation({ id: row.invitation_id, decision: "accepted" })}>Aceitar convite</button>
            <button className={button} aria-label={`Recusar convite de ${row.band_name}`} disabled={busy} onClick={() => setConfirmation({ id: row.invitation_id, decision: "rejected" })}>Recusar convite</button>
          </div>}
          {confirmation?.id === row.invitation_id && <div role="group" aria-label="Confirmar decisão do convite" className="space-y-3 rounded-xl bg-accent-soft p-3">
            <p>{confirmation.decision === "accepted" ? `Entrar na banda ${row.band_name} como membro?` : `Recusar o convite de ${row.band_name}?`}</p>
            <button className={button} disabled={busy} onClick={() => void decide()}>Confirmar</button>{" "}
            <button className={button} disabled={busy} onClick={() => setConfirmation(null)}>Voltar</button>
          </div>}
        </li>)}</ul>}
    <div className="flex flex-wrap gap-3">
      <button className={button} disabled={busy || loading} onClick={() => { setFeedback(null); setRevision(value => value + 1); }}>Atualizar convites</button>
      <button className={button} disabled={busy || loading || offset === 0} onClick={() => setOffset(value => Math.max(0, value - INVITATION_PAGE_SIZE))}>Anteriores</button>
      <button className={button} disabled={busy || loading || failed || rows.length < INVITATION_PAGE_SIZE || offset >= 10000} onClick={() => setOffset(value => value + INVITATION_PAGE_SIZE)}>Próximos</button>
    </div>
  </section>;
}

export function MusicianInvitationDiscovery() {
  if (!BAND_INVITATIONS_ENABLED) return null;
  return <InvitationDiscovery />;
}

function InvitationDiscovery() {
  const [api] = useState(() => createBandInvitationService(getSupabaseBrowserClient()));
  const [bands, setBands] = useState<InvitationBand[]>([]);
  const [bandId, setBandId] = useState("");
  const [searchFailed, setSearchFailed] = useState(false);
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState({ query: "", offset: 0, revision: 0 });
  const [rows, setRows] = useState<InvitationMusician[]>([]);
  const [hasNext, setHasNext] = useState(false);
  const [loading, setLoading] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<string[]>([]);
  const [uncertain, setUncertain] = useState(false);
  const action = useRef(false);
  const live = useRef(false);
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  useEffect(() => {
    if (!search.query) return;
    let active = true;
    setLoading(true); setRows([]); setHasNext(false); setSearchFailed(false);
    void Promise.all([api.discover(search.query, search.offset), api.adminBands()]).then(([result, adminBands]) => {
      if (!active) return;
      setRows(result.musicians); setHasNext(result.hasNext); setBands(adminBands);
      setBandId(previous => adminBands.some(b => b.id === previous) ? previous : adminBands[0]?.id ?? "");
    }).catch(() => {
      if (active) { setBands([]); setBandId(""); setSearchFailed(true); }
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [api, search]);

  async function send(musician: InvitationMusician) {
    if (!musician.musicianRef || !bandId || action.current || uncertain) return;
    const key = `${bandId}:${musician.musicianRef}`;
    if (sent.includes(key)) return;
    action.current = true; setBusy(true); setFeedback(null);
    try {
      await api.send(bandId, musician.musicianRef);
      if (live.current) { setSent(previous => [...previous, key]); setFeedback({ error: false, message: `Convite enviado para ${musician.name}. A entrada depende do aceite.` }); }
    } catch (error) {
      if (live.current) { setUncertain(true); setFeedback({ error: true, message: invitationError(error).message }); }
    } finally { action.current = false; if (live.current) setBusy(false); }
  }
  async function reconcile() {
    if (!bandId || action.current) return;
    action.current = true; setBusy(true);
    try {
      const invitations = await api.list(bandId);
      if (!live.current) return;
      setSent(previous => [...new Set([...previous, ...invitations.map(row => `${row.band_id}:${row.musician_ref}`)])]);
      setUncertain(false); setFeedback({ error: false, message: "Convites enviados atualizados. Confira o acompanhamento na banda." });
    } catch (error) { if (live.current) setFeedback({ error: true, message: invitationError(error).message }); }
    finally { action.current = false; if (live.current) setBusy(false); }
  }
  return <section className={panel} aria-label="Descobrir músicos e convidar" aria-busy={loading || busy}>
    <form onSubmit={event => {
      event.preventDefault();
      const name = query.trim();
      if (!name || busy) return;
      setFeedback(null);
      setLoading(true);
      setSearch(previous => ({ query: name, offset: 0, revision: previous.revision + 1 }));
    }} className="space-y-3">
      <label className="block text-sm font-semibold" htmlFor="invitation-query">Buscar músico por nome</label>
      <input id="invitation-query" type="search" maxLength={100} value={query} onChange={event => setQuery(event.target.value)} className="min-h-11 min-w-0 w-full rounded-xl border border-outline bg-surface px-4 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-focus" />
      <button type="submit" className={button} disabled={busy || !query.trim()}>Buscar músicos</button>
    </form>
    <Notice feedback={feedback} />
    {busy && <p role="status" className="text-sm text-content-muted">Processando convite...</p>}
    {!search.query ? <p role="status" className="text-sm text-content-muted">Digite um nome para buscar músicos.</p>
      : loading ? <p role="status">Carregando músicos...</p> : searchFailed ? <div className="space-y-3">
        <p role="alert" className="text-sm text-danger">Não foi possível carregar os músicos. Tente novamente.</p>
        <button className={button} onClick={() => { setLoading(true); setSearch(previous => ({ ...previous, revision: previous.revision + 1 })); }}>Tentar novamente</button>
      </div> : <>
      {bands.length > 0 ? <label className="block space-y-2"><span>Banda que fará o convite</span><select value={bandId} disabled={busy} onChange={event => setBandId(event.target.value)} className="min-h-11 min-w-0 w-full rounded-xl border border-outline bg-surface px-3 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-focus">{bands.map(band => <option key={band.id} value={band.id}>{band.name}</option>)}</select></label>
        : <p className="text-sm text-content-muted">Você precisa administrar uma banda para enviar convites.</p>}
      {rows.length === 0 && <p role="status">Nenhum músico encontrado.</p>}
      <ul className="grid min-w-0 gap-3 sm:grid-cols-2">{rows.map((musician, index) => <li key={musician.musicianRef ?? `${search.offset}:${index}`} className="min-w-0 space-y-3 rounded-xl border border-nav-border p-4">
        <div className="flex min-w-0 items-center gap-3">
          <ProfileAvatar name={musician.name} imageUrl={musician.avatarUrl} />
          <div className="min-w-0">
            <h2 className="break-words font-semibold">{musician.name}</h2>
            <p className="text-sm text-content-muted">{musician.available ? "Disponível para bandas" : "Indisponível para bandas"}</p>
          </div>
        </div>
        {musician.available && musician.musicianRef && bands.length > 0 && <button className={button} aria-label={`${sent.includes(`${bandId}:${musician.musicianRef}`) ? "Convite enviado para" : "Convidar"} ${musician.name}`} disabled={busy || uncertain || sent.includes(`${bandId}:${musician.musicianRef}`)} onClick={() => void send(musician)}>{sent.includes(`${bandId}:${musician.musicianRef}`) ? "Convite enviado" : "Convidar músico"}</button>}
      </li>)}</ul>
    </>}
    {uncertain && <button className={button} disabled={busy || !bandId} onClick={() => void reconcile()}>Atualizar convites enviados</button>}
    {search.query && <nav aria-label="Páginas de músicos" className="flex flex-wrap gap-3">
      <button className={button} disabled={busy || loading || search.offset === 0} onClick={() => setSearch(previous => ({ ...previous, offset: Math.max(0, previous.offset - INVITATION_PAGE_SIZE) }))}>Anteriores</button>
      <button className={button} disabled={busy || loading || !hasNext} onClick={() => setSearch(previous => ({ ...previous, offset: previous.offset + INVITATION_PAGE_SIZE }))}>Próximos</button>
    </nav>}
  </section>;
}
