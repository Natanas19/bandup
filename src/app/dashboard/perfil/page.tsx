"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import type { User } from "@supabase/supabase-js";
import Link from "next/link";
import AvatarCompletion from "@/components/avatar-completion";
import MusicianAvailability from "@/components/musician-availability";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { normalizeDisplayName } from "@/lib/display-name";
import { bioLength, validBio, safeProfilePhoto, savePersonalMetadata, type ProfileEdits } from "@/lib/personal-profile-edit";

const input = "min-h-11 w-full min-w-0 rounded-xl border border-outline bg-surface px-4 py-3 text-base text-content focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-focus disabled:opacity-60";
const notify = () => window.dispatchEvent(new Event("bandup:personal-profile-updated"));

export default function PersonalProfilePage() {
  const [user, setUser] = useState<User | null>(null);
  const [name, setName] = useState("");
  const [bio, setBio] = useState("");
  const [phase, setPhase] = useState<"loading" | "ready" | "blocked" | "error">("loading");
  const [busy, setBusy] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);
  const baseline = useRef({ name: "", bio: "" });
  const owner = useRef("");
  const live = useRef(false);
  const pending = useRef(false);
  const operation = useRef<AbortController | null>(null);

  useEffect(() => {
    live.current = true;
    const client = getSupabaseBrowserClient();
    let generation = 0;
    const { data: listener } = client.auth.onAuthStateChange((_event, session) => {
      if (!session || (owner.current && session.user.id !== owner.current)) {
        generation++; operation.current?.abort(); owner.current = "";
        setUser(null); setName(""); setBio(""); setPhase("blocked");
      }
    });
    const ticket = generation;
    void (async () => {
      try {
        const { data, error } = await client.auth.getUser();
        if (!live.current || ticket !== generation) return;
        if (error || !data.user || data.user.is_anonymous) { setPhase("blocked"); return; }
        const { data: current, error: sessionError } = await client.auth.getSession();
        if (!live.current || ticket !== generation) return;
        if (sessionError || current.session?.user.id !== data.user.id) { setPhase("blocked"); return; }
        owner.current = data.user.id;
        const loadedName = normalizeDisplayName(data.user.user_metadata?.display_name)
          ?? normalizeDisplayName(data.user.user_metadata?.full_name)
          ?? normalizeDisplayName(data.user.user_metadata?.name) ?? "";
        const loadedBio = typeof data.user.user_metadata?.bio === "string" ? data.user.user_metadata.bio : "";
        baseline.current = { name: loadedName, bio: loadedBio };
        setUser(data.user); setName(loadedName); setBio(loadedBio); setPhase("ready");
      } catch { if (live.current && ticket === generation) setPhase("error"); }
    })();
    return () => { live.current = false; generation++; operation.current?.abort(); listener.subscription.unsubscribe(); };
  }, []);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending.current || photoBusy || !user || phase !== "ready") return;
    if (!normalizeDisplayName(name) || !validBio(bio)) { setFailed(true); setMessage("Confira o nome e a descrição antes de salvar."); return; }
    const edits: ProfileEdits = {};
    if (name !== baseline.current.name) edits.display_name = name;
    if (bio !== baseline.current.bio) edits.bio = bio;
    if (!Object.keys(edits).length) { setFailed(false); setMessage("Nenhuma alteração de nome ou descrição para salvar."); return; }
    pending.current = true; setBusy(true); setMessage(""); setFailed(false);
    const abort = new AbortController(); operation.current = abort;
    const timeout = window.setTimeout(() => abort.abort(), 30000);
    try {
      const result = await savePersonalMetadata(getSupabaseBrowserClient(), user.id, edits, abort.signal);
      if (!live.current || abort.signal.aborted || owner.current !== user.id) return;
      if (result.fields.display_name === "saved") { baseline.current.name = result.user.user_metadata.display_name; setName(baseline.current.name); }
      if (result.fields.bio === "saved") { baseline.current.bio = result.user.user_metadata.bio; }
      setUser(result.user);
      setFailed(Object.values(result.fields).includes("error"));
      setMessage(Object.entries(result.fields).map(([field, status]) => `${field === "bio" ? "Descrição" : "Nome"}: ${status === "saved" ? "salvo" : "não foi possível salvar; tente novamente"}.`).join(" "));
      notify();
    } catch {
      if (live.current && owner.current === user.id) {
        setFailed(true); setMessage("Não foi possível confirmar todas as alterações. Alguns dados podem ter sido salvos. Recarregue para conferir antes de tentar novamente.");
        notify();
      }
    } finally { window.clearTimeout(timeout); pending.current = false; if (live.current) setBusy(false); }
  }

  const savedAvatar = user?.user_metadata?.avatar_url ?? user?.user_metadata?.picture;
  return <main className="min-w-0 flex-1 px-4 py-6 sm:px-6 sm:py-8 lg:px-10 lg:py-10">
    <div className="mx-auto w-full max-w-3xl">
      <h1 className="text-3xl font-semibold tracking-tight text-content sm:text-4xl">Meu perfil</h1>
      {phase === "loading" ? <p role="status" className="mt-6 text-content-muted">Carregando seu perfil...</p>
        : phase !== "ready" || !user ? <section className="mt-6 space-y-3">
          <p role="alert" className="text-content-muted">Não foi possível verificar sua conta. Entre novamente ou recarregue a página.</p>
          <Link href="/login" className="inline-flex min-h-11 items-center text-brand">Ir para o login</Link>
        </section> : <>
          <AvatarCompletion key={user.id} userId={user.id} name={name || "Meu perfil"} disabled={busy} onBusyChange={setPhotoBusy}
            currentImageUrl={safeProfilePhoto(savedAvatar)}
            onSaved={url => {
              if (!live.current || owner.current !== user.id) return;
              setUser(current => current?.id === user.id ? { ...current, user_metadata: { ...current.user_metadata, avatar_url: url } } : current);
              notify();
            }} />
          <form onSubmit={save} aria-busy={busy} className="mt-6 space-y-5 rounded-panel border border-outline bg-surface p-5 sm:p-6">
            <p className="text-sm text-content-muted">A foto é confirmada separadamente. Este formulário salva nome e descrição.</p>
            <div><label htmlFor="profile-name" className="mb-2 block text-sm font-semibold text-content">Nome de exibição</label>
              <input id="profile-name" autoComplete="nickname" required maxLength={80} value={name} disabled={busy || photoBusy}
                onChange={event => setName(event.target.value)} className={input} /></div>
            <div><label htmlFor="profile-email" className="mb-2 block text-sm font-semibold text-content">E-mail</label>
              <input id="profile-email" type="email" autoComplete="email" readOnly value={user.email ?? ""} className={`${input} bg-surface-muted`} aria-describedby="profile-email-help" />
              <p id="profile-email-help" className="mt-2 text-xs text-content-muted">O e-mail não pode ser alterado nesta página.</p></div>
            <div><label htmlFor="profile-bio" className="mb-2 block text-sm font-semibold text-content">Descrição pessoal (opcional)</label>
              <textarea id="profile-bio" rows={4} value={bio} disabled={busy || photoBusy} onChange={event => setBio(event.target.value)}
                aria-describedby="profile-bio-count" aria-invalid={!validBio(bio)} className={input} />
              <p id="profile-bio-count" className={`mt-2 text-xs ${validBio(bio) ? "text-content-muted" : "text-danger"}`}>{bioLength(bio)}/300 caracteres</p></div>
            <button type="submit" disabled={busy || photoBusy || !normalizeDisplayName(name) || !validBio(bio)} className="min-h-11 rounded-xl bg-primary px-4 py-3 text-sm font-semibold text-on-primary disabled:opacity-60">{busy ? "Salvando..." : "Salvar nome e descrição"}</button>
            {message && <p role={failed ? "alert" : "status"} className={`break-words text-sm ${failed ? "text-danger" : "text-content-muted"}`}>{message}</p>}
          </form>
          <MusicianAvailability key={`availability:${user.id}`} userId={user.id} />
        </>}
    </div>
  </main>;
}
