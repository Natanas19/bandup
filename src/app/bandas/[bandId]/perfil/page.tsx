"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useParams } from "next/navigation";
import BandNavigation from "@/components/band-navigation";
import { BandWorkspaceInfo } from "@/components/band-workspace";
import BandPhotoPicker from "@/components/band-photo-picker";
import ProfileAvatar from "@/components/profile-avatar";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { loadBandProfile, saveBandProfile, type BandProfileAccess } from "@/lib/band-profile";
import { uploadBandLogo } from "@/lib/band-logo-upload";
import { safeBandLogo } from "@/lib/public-band-data";
import { requiredTextError } from "@/lib/form-validation";

const input = "min-h-11 w-full min-w-0 rounded-xl border border-outline bg-surface px-4 py-3 text-base text-content focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-focus disabled:opacity-60";
const button = "min-h-11 rounded-xl bg-primary px-4 py-3 text-sm font-semibold text-on-primary disabled:opacity-60";
const notify = () => window.dispatchEvent(new Event("bandup:band-profile-updated"));

export default function BandProfilePage() {
  const { bandId } = useParams<{ bandId: string }>();
  return <BandProfileEditor key={bandId} bandId={bandId} />;
}

function BandProfileEditor({ bandId }: { bandId: string }) {
  const [access, setAccess] = useState<BandProfileAccess | null>(null);
  const [phase, setPhase] = useState<"loading" | "ready" | "unavailable">("loading");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState<"text" | "photo" | null>(null);
  const [textMessage, setTextMessage] = useState("");
  const [photoMessage, setPhotoMessage] = useState("");
  const [failed, setFailed] = useState({ text: false, photo: false });
  const owner = useRef("");
  const live = useRef(false);
  const pending = useRef(false);
  const attempt = useRef("");
  const operation = useRef<AbortController | null>(null);

  useEffect(() => {
    live.current = true;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => {
      controller.abort();
      if (live.current) { setAccess(null); setPhase("unavailable"); }
    }, 15000);
    const client = getSupabaseBrowserClient();
    const { data: listener } = client.auth.onAuthStateChange((_event, session) => {
      if (!session || (owner.current && session.user.id !== owner.current)) {
        controller.abort(); operation.current?.abort(); owner.current = "";
        setAccess(null); setFile(null); setName(""); setDescription(""); setPhase("unavailable");
      }
    });
    void (async () => {
      try {
        const { data, error } = await client.auth.getUser();
        if (!live.current || controller.signal.aborted) return;
        if (error || !data.user || data.user.is_anonymous) throw Error("Unavailable");
        owner.current = data.user.id;
        const loaded = await loadBandProfile(client, data.user.id, bandId, controller.signal);
        if (!live.current || controller.signal.aborted) return;
        setAccess(loaded); setName(loaded.band.name); setDescription(loaded.band.description ?? ""); setPhase("ready");
      } catch { if (live.current) { setAccess(null); setPhase("unavailable"); } }
      finally { window.clearTimeout(timeout); }
    })();
    return () => { live.current = false; controller.abort(); operation.current?.abort(); window.clearTimeout(timeout); listener.subscription.unsubscribe(); };
  }, [bandId]);

  async function save(kind: "text" | "photo") {
    if (pending.current || access?.role !== "admin" || !owner.current || phase !== "ready") return;
    if (kind === "photo" && (!file || !attempt.current)) return;
    pending.current = true; setBusy(kind);
    if (kind === "text") setTextMessage(""); else setPhotoMessage("");
    setFailed(current => ({ ...current, [kind]: false }));
    const actor = owner.current, client = getSupabaseBrowserClient();
    const controller = new AbortController(); operation.current = controller;
    const timeout = window.setTimeout(() => controller.abort(), 30000);
    try {
      if (kind === "text") {
        const result = await saveBandProfile(client, actor, bandId, name, description, controller.signal);
        if (!live.current || controller.signal.aborted || owner.current !== actor) return;
        setAccess(result); setName(result.band.name); setDescription(result.band.description ?? "");
        setTextMessage("Nome e descrição salvos. A foto é confirmada separadamente.");
      } else {
        const url = await uploadBandLogo(client, actor, bandId, file!, attempt.current, controller.signal);
        if (!live.current || controller.signal.aborted || owner.current !== actor) return;
        setAccess(current => current ? { ...current, band: { ...current.band, logo_url: url } } : current);
        setFile(null); attempt.current = "";
        setPhotoMessage("Foto salva. Nome e descrição não foram alterados por este envio.");
      }
      notify();
    } catch {
      if (!live.current || owner.current !== actor) return;
      setFailed(current => ({ ...current, [kind]: true }));
      const message = "Não foi possível confirmar a alteração. Alguns dados podem ter sido salvos. Confira seu acesso e os dados antes de tentar novamente.";
      if (kind === "text") setTextMessage(message); else setPhotoMessage(message);
      notify();
      // Recheck access after any refusal, including an administrator demotion.
      // Failure to revalidate hides the private page rather than trusting old UI state.
      try {
        if (controller.signal.aborted) throw Error("Expired operation");
        const current = await loadBandProfile(client, actor, bandId, controller.signal);
        if (live.current && owner.current === actor && !controller.signal.aborted) {
          setAccess(current);
          if (current.role !== "admin") { setFile(null); attempt.current = ""; }
        }
      } catch { if (live.current && owner.current === actor) { setAccess(null); setPhase("unavailable"); } }
    } finally { window.clearTimeout(timeout); pending.current = false; if (live.current) setBusy(null); }
  }

  if (phase !== "ready" || !access) return <main className="min-w-0 flex-1 px-4 py-6 sm:px-6 sm:py-8 lg:px-10">
    <p role={phase === "loading" ? "status" : "alert"} className="text-content-muted">{phase === "loading" ? "Carregando perfil da banda..." : "Banda indisponível. Você precisa estar autenticado e participar desta banda. Recarregue para conferir seu acesso."}</p>
  </main>;

  const admin = access.role === "admin";
  const invalid = !!requiredTextError(name, "o nome da banda") || name.trim().length > 100 || description.length > 500;
  return <main className="min-w-0 flex-1 px-4 py-6 sm:px-6 sm:py-8 lg:px-10 lg:py-10">
    <BandWorkspaceInfo name={access.band.name} role={access.role} />
    <BandNavigation bandId={bandId} activeSection="overview" />
    <div className="mx-auto w-full max-w-3xl">
      <h1 className="text-3xl font-semibold tracking-tight text-content sm:text-4xl">Perfil da banda</h1>
      <section className="mt-6 space-y-4 rounded-panel border border-outline bg-surface p-5 sm:p-6">
        <h2 className="text-lg font-semibold text-content">Foto da banda</h2>
        {!admin && <ProfileAvatar name={access.band.name} imageUrl={safeBandLogo(access.band.logo_url, process.env.NEXT_PUBLIC_SUPABASE_URL ?? "https://invalid.local")} />}
        {admin && <>
          <BandPhotoPicker file={file} disabled={!!busy} name={access.band.name} currentImageUrl={safeBandLogo(access.band.logo_url, process.env.NEXT_PUBLIC_SUPABASE_URL ?? "https://invalid.local")} onChange={selected => { if (pending.current) return; setFile(selected); attempt.current = selected ? crypto.randomUUID() : ""; setPhotoMessage(""); }} />
          <button type="button" disabled={!!busy || !file} onClick={() => void save("photo")} className={button}>{busy === "photo" ? "Confirmando foto..." : "Salvar foto"}</button>
        </>}
      </section>
      {photoMessage && <p role={failed.photo ? "alert" : "status"} className="mt-3 text-sm text-content-muted">{photoMessage}</p>}
      {admin ? <form aria-busy={busy === "text"} onSubmit={(event: FormEvent<HTMLFormElement>) => { event.preventDefault(); void save("text"); }} className="mt-6 space-y-5 rounded-panel border border-outline bg-surface p-5 sm:p-6">
        <div><label htmlFor="band-profile-name" className="mb-2 block text-sm font-semibold text-content">Nome da banda</label>
          <input id="band-profile-name" required maxLength={100} value={name} disabled={!!busy} onChange={event => setName(event.target.value)} className={input} /></div>
        <div><label htmlFor="band-profile-description" className="mb-2 block text-sm font-semibold text-content">Descrição (opcional)</label>
          <textarea id="band-profile-description" rows={4} maxLength={500} value={description} disabled={!!busy} onChange={event => setDescription(event.target.value)} aria-describedby="band-profile-count" className={input} />
          <p id="band-profile-count" className="mt-2 text-xs text-content-muted">{description.length}/500 caracteres</p></div>
        <p className="text-sm text-content-muted">Este formulário salva somente nome e descrição. A foto é confirmada separadamente.</p>
        <button type="submit" disabled={!!busy || invalid} className={button}>{busy === "text" ? "Salvando..." : "Salvar nome e descrição"}</button>
      </form> : <section className="mt-6 space-y-4 rounded-panel border border-outline bg-surface p-5 sm:p-6">
        <p className="text-sm text-content-muted">Somente administradores podem editar o perfil da banda.</p>
        <div><h2 className="text-sm font-semibold text-content-muted">Nome</h2><p className="break-words text-content [overflow-wrap:anywhere]">{access.band.name}</p></div>
        <div><h2 className="text-sm font-semibold text-content-muted">Descrição</h2><p className="whitespace-pre-wrap break-words text-content [overflow-wrap:anywhere]">{access.band.description || "Sem descrição."}</p></div>
      </section>}
      {textMessage && <p role={failed.text ? "alert" : "status"} className="mt-3 text-sm text-content-muted">{textMessage}</p>}
    </div>
  </main>;
}
