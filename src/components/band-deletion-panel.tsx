"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { browserBandDeletionAttempts, type BandDeletionAttempt } from "@/lib/band-deletion-attempts";
import { DELETION_UNCERTAIN, loadBandDeletionAccess, recoverBandDeletion, submitBandDeletion } from "@/lib/band-deletion";

const button = "min-h-11 rounded-xl border px-4 py-3 text-sm font-semibold focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-focus disabled:cursor-not-allowed disabled:opacity-50";
type Access = { actorId: string; name: string; admin: boolean };

// Bound the entire step, including browser storage and SDK Auth locks. Aborting
// fetch alone would leave the UI busy if either of those promises stalled.
function withinSignal<T>(work: PromiseLike<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => { signal.removeEventListener("abort", abort); reject(new Error("Request interrupted")); };
    signal.addEventListener("abort", abort, { once: true });
    Promise.resolve(work).then(value => { signal.removeEventListener("abort", abort); resolve(value); },
      error => { signal.removeEventListener("abort", abort); reject(error); });
    if (signal.aborted) abort();
  });
}

export default function BandDeletionPanel({ bandId, recoveryOnly = false }: { bandId: string; recoveryOnly?: boolean }) {
  const [access, setAccess] = useState<Access | null>(null);
  const [attempt, setAttempt] = useState<BandDeletionAttempt | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [deleted, setDeleted] = useState(false);
  const [message, setMessage] = useState("");
  const [loadError, setLoadError] = useState(false);
  const [revision, setRevision] = useState(0);
  const life = useRef<AbortController | null>(null);
  const inFlight = useRef(false);
  const input = useRef<HTMLInputElement>(null);
  const opener = useRef<HTMLButtonElement>(null);
  const restoreFocus = useRef(false);
  const titleId = `band-deletion-${bandId}`;

  async function complete(saved: BandDeletionAttempt, signal: AbortSignal) {
    if (signal.aborted || life.current?.signal.aborted) return;
    setDeleted(true); setConfirmation("");
    const cleanup = new AbortController();
    const abort = () => cleanup.abort();
    signal.addEventListener("abort", abort, { once: true });
    const timer = setTimeout(abort, 8000);
    try { await withinSignal(browserBandDeletionAttempts().remove(saved), cleanup.signal); }
    catch {
      if (!signal.aborted) setMessage("Exclusão confirmada. Não foi possível limpar o registro local; clique em Concluir para tentar novamente.");
      return;
    } finally { clearTimeout(timer); signal.removeEventListener("abort", abort); }
    if (signal.aborted || life.current?.signal.aborted) return;
    setAttempt(null);
    window.dispatchEvent(new Event("bandup:band-profile-updated"));
    // A full navigation also discards stale membership and workspace caches.
    window.location.replace("/dashboard");
  }

  useEffect(() => {
    const active = new AbortController(); life.current = active;
    let actorId = "";
    setAccess(null); setAttempt(null); setExpanded(false); setConfirmation("");
    setMessage(""); setLoadError(false); setDeleted(false); setBusy(false); inFlight.current = false;
    let unsubscribe = () => {};
    const timer = setTimeout(() => { active.abort(); setLoadError(true); }, 20000);
    try {
      const client = getSupabaseBrowserClient();
      const { data } = client.auth.onAuthStateChange((event, session) => {
        if (event === "SIGNED_OUT" || (actorId && session?.user.id !== actorId)) {
          active.abort(); clearTimeout(timer); setAccess(null); setAttempt(null); setConfirmation(""); setMessage("");
        }
      });
      unsubscribe = () => data.subscription.unsubscribe();
      void (async () => {
        const auth = await withinSignal(loadBandDeletionAccess(client, active.signal), active.signal); actorId = auth.actorId;
        const saved = await withinSignal(browserBandDeletionAttempts().read(actorId, bandId), active.signal);
        let name = "", admin = false;
        if (!recoveryOnly) {
          const membership = await auth.scoped.from("band_members").select("role")
            .eq("band_id", bandId).eq("user_id", actorId).maybeSingle();
          if (membership.error) throw new Error("Access unavailable");
          if (membership.data?.role === "admin") {
            const band = await auth.scoped.from("bands").select("name").eq("id", bandId).maybeSingle();
            if (band.error) throw new Error("Band unavailable");
            name = band.data?.name ?? ""; admin = !!name;
          }
        }
        await auth.verify();
        if (active.signal.aborted) return;
        setAccess({ actorId, name, admin }); setAttempt(saved); setExpanded(!!saved);
        if (saved) {
          const result = await recoverBandDeletion(client, saved, active.signal);
          if (active.signal.aborted) return;
          if (result.status === "deleted") await complete(saved, active.signal);
          else setMessage(result.message);
        }
      })().catch(() => { if (!active.signal.aborted) setLoadError(true); })
        .finally(() => { clearTimeout(timer); });
    } catch { setLoadError(true); clearTimeout(timer); }
    return () => { active.abort(); clearTimeout(timer); unsubscribe(); };
  }, [bandId, recoveryOnly, revision]);

  useEffect(() => {
    if (expanded && !recoveryOnly) input.current?.focus();
    else if (restoreFocus.current) { restoreFocus.current = false; opener.current?.focus(); }
  }, [expanded, recoveryOnly]);

  async function run(send: boolean) {
    const parent = life.current;
    if (inFlight.current || !access || !parent || parent.signal.aborted) return;
    const expected = attempt?.confirmation ?? access.name;
    if (send && (recoveryOnly || !access.admin || deleted || confirmation !== expected)) return;
    inFlight.current = true; setBusy(true); setMessage("");
    let saved = attempt;
    let request = new AbortController();
    const abort = () => request.abort();
    parent.signal.addEventListener("abort", abort);
    let timer = setTimeout(abort, 25000);
    try {
      const store = browserBandDeletionAttempts(), client = getSupabaseBrowserClient();
      if (deleted && saved) { await complete(saved, parent.signal); return; }
      const response = send
        ? await withinSignal(submitBandDeletion(client, store, access.actorId, bandId, confirmation, expected, request.signal, attempt ?? undefined), request.signal)
        : saved ? { attempt: saved, result: await withinSignal(recoverBandDeletion(client, saved, request.signal), request.signal) } : null;
      if (parent.signal.aborted || !response) return;
      saved = response.attempt; setAttempt(saved);
      if (response.result.status === "deleted") await complete(saved, parent.signal);
      else setMessage(response.result.message);
    } catch {
      if (parent.signal.aborted) return;
      // A timeout may have committed. One bounded read with a fresh signal;
      // never launch a second mutation automatically.
      clearTimeout(timer); request.abort(); request = new AbortController();
      timer = setTimeout(abort, 10000);
      try {
        saved = await withinSignal(browserBandDeletionAttempts().read(access.actorId, bandId), request.signal);
        if (parent.signal.aborted) return;
        setAttempt(saved);
        if (!saved) {
          setMessage("Não foi possível recuperar um registro local seguro. O resultado é inconclusivo. Verifique sua sessão e o armazenamento do navegador; nenhuma nova operação será criada automaticamente.");
          return;
        }
        const result = await withinSignal(recoverBandDeletion(getSupabaseBrowserClient(), saved, request.signal), request.signal);
        if (parent.signal.aborted) return;
        if (result.status === "deleted") await complete(saved, parent.signal); else setMessage(result.message);
      } catch { if (!parent.signal.aborted) setMessage(DELETION_UNCERTAIN); }
    } finally {
      clearTimeout(timer); request.abort(); parent.signal.removeEventListener("abort", abort);
      if (!parent.signal.aborted) { setBusy(false); inFlight.current = false; }
    }
  }

  if (loadError) return <section className="mx-4 my-6 rounded-2xl border border-nav-border bg-surface p-5 sm:mx-6">
    <p role="alert" className="text-sm text-content-muted">Não foi possível verificar as tentativas de exclusão neste navegador.</p>
    <button type="button" className={`${button} mt-3 border-accent-border text-brand`} onClick={() => setRevision(v => v + 1)}>Verificar novamente</button>
  </section>;
  if (!access || (!access.admin && !attempt)) return null;
  const canDelete = access.admin && !recoveryOnly && !deleted;
  const expected = attempt?.confirmation ?? access.name;
  const submit = (event: FormEvent) => { event.preventDefault(); void run(true); };
  return <div className="flex justify-center px-4 pb-8 sm:px-6">
    <section aria-labelledby={titleId} aria-busy={busy} className="w-full min-w-0 max-w-5xl rounded-2xl border border-danger-border bg-surface p-5 sm:p-6">
      <h2 id={titleId} className="text-lg font-semibold text-danger">{deleted ? "Exclusão confirmada" : canDelete ? "Excluir banda" : "Resultado de exclusão pendente"}</h2>
      {!canDelete && attempt && <p className="mt-3 break-words text-sm text-content [overflow-wrap:anywhere]">Banda da tentativa: <strong>{attempt.confirmation}</strong></p>}
      {canDelete && <p id={`${titleId}-warning`} className="mt-3 text-sm leading-6 text-content-muted">
        Esta ação é permanente e não pode ser desfeita. A banda, seus vínculos de integrantes, tarefas, agenda, links e demais dados relacionados serão excluídos para todos. As contas pessoais dos integrantes permanecem. Qualquer administrador pode excluir a banda, mesmo havendo outros administradores.
        A limpeza dos arquivos de logo ocorre separadamente e pode permanecer pendente.
      </p>}
      {canDelete && !expanded && <button ref={opener} type="button" aria-expanded={false} aria-controls={`${titleId}-form`}
        className={`${button} mt-4 border-danger-border text-danger`} onClick={() => setExpanded(true)}>Quero excluir esta banda</button>}
      {canDelete && expanded && <form id={`${titleId}-form`} onSubmit={submit} className="mt-5">
        <p className="break-words text-sm text-content [overflow-wrap:anywhere]">Digite exatamente: <strong>{expected}</strong></p>
        {attempt && <p className="mt-2 text-sm text-content-muted">Há uma tentativa salva. Repetir usa a mesma operação e a confirmação original.</p>}
        <label htmlFor={`${titleId}-name`} className="mt-4 block text-sm font-medium text-content">Nome exato da banda</label>
        <input ref={input} id={`${titleId}-name`} value={confirmation} disabled={busy} autoComplete="off" spellCheck={false}
          autoCapitalize="off" aria-describedby={`${titleId}-warning`} onChange={event => setConfirmation(event.target.value)}
          className="mt-2 min-h-11 w-full rounded-xl border border-outline bg-surface px-3 py-3 text-content focus:outline-none focus:ring-4 focus:ring-input-ring" />
        <div className="mt-4 flex flex-wrap gap-3">
          <button type="submit" disabled={busy || confirmation !== expected || !confirmation} className={`${button} border-danger-border bg-danger-surface text-danger hover:bg-danger-soft`}>
            {busy ? "Verificando…" : attempt ? "Repetir mesma tentativa" : "Excluir banda permanentemente"}
          </button>
          {!attempt && <button type="button" disabled={busy} className={`${button} border-nav-border text-content-muted`} onClick={() => {
            restoreFocus.current = true; setExpanded(false); setConfirmation("");
          }}>Cancelar</button>}
        </div>
      </form>}
      {attempt && <button type="button" disabled={busy} className={`${button} mt-4 border-accent-border text-brand`}
        onClick={() => { void run(false); }}>{deleted ? "Concluir" : "Consultar resultado"}</button>}
      {message && <p role="alert" className="mt-4 text-sm leading-6 text-content-muted">{message}</p>}
      {busy && <p role="status" className="mt-3 text-sm text-content-muted">Aguarde a confirmação. Se sair da página, a tentativa continuará salva neste navegador.</p>}
    </section>
  </div>;
}

// Read-only recovery survives the private band boundary redirect after deletion.
// No mutation controls are rendered on the personal dashboard.
export function BandDeletionRecovery() {
  const [bandIds, setBandIds] = useState<string[]>([]);
  const [failed, setFailed] = useState(false);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    let actorId = "";
    setFailed(false); setBandIds([]);
    const timer = setTimeout(() => { controller.abort(); setFailed(true); }, 15000);
    let unsubscribe = () => {};
    try {
      const client = getSupabaseBrowserClient();
      const { data } = client.auth.onAuthStateChange((event, session) => {
        if (event === "SIGNED_OUT" || (actorId && session?.user.id !== actorId)) {
          controller.abort(); clearTimeout(timer); setBandIds([]); setFailed(false);
        }
      });
      unsubscribe = () => data.subscription.unsubscribe();
      void withinSignal(loadBandDeletionAccess(client, controller.signal), controller.signal).then(async auth => {
        actorId = auth.actorId;
        const saved = await withinSignal(browserBandDeletionAttempts().list(auth.actorId), controller.signal);
        await auth.verify();
        if (!controller.signal.aborted) setBandIds(saved.map(a => a.bandId));
      }).catch(() => { if (!controller.signal.aborted) setFailed(true); }).finally(() => clearTimeout(timer));
    } catch { clearTimeout(timer); setFailed(true); }
    return () => { controller.abort(); clearTimeout(timer); unsubscribe(); };
  }, [revision]);
  return <>{failed && <section className="mb-5 rounded-2xl border border-nav-border bg-surface p-5">
    <p role="alert" className="text-sm text-content-muted">Não foi possível verificar tentativas de exclusão salvas neste navegador.</p>
    <button type="button" className={`${button} mt-3 border-accent-border text-brand`} onClick={() => setRevision(v => v + 1)}>Verificar novamente</button>
  </section>}{bandIds.map(bandId => <BandDeletionPanel key={bandId} bandId={bandId} recoveryOnly />)}</>;
}
