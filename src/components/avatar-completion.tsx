"use client";

import { useEffect, useRef, useState, type ChangeEvent } from "react";
import ProfileAvatar from "@/components/profile-avatar";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { AvatarUploadError, uploadAvatarForUser, validateAvatarFile } from "@/lib/avatar-upload";
import { discardAvatarDraft, loadAvatarDraft, saveAvatarDraft, type AvatarDraft } from "@/lib/avatar-draft";

export default function AvatarCompletion({ userId, currentImageUrl, name = "Meu perfil", onSaved, disabled = false, onBusyChange }: {
  userId: string; currentImageUrl?: string | null; name?: string; onSaved?: (url: string) => void;
  disabled?: boolean; onBusyChange?: (busy: boolean) => void;
}) {
  const [draft, setDraft] = useState<AvatarDraft | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [phase, setPhase] = useState<"loading" | "ready" | "busy" | "blocked">("loading");
  const [message, setMessage] = useState("");
  const currentDraft = useRef<AvatarDraft | null>(null);
  const active = useRef(false);
  const working = useRef(false);
  const operation = useRef<AbortController | null>(null);

  useEffect(() => {
    onBusyChange?.(phase === "busy" || phase === "loading");
  }, [phase, onBusyChange]);

  useEffect(() => {
    let mounted = true;
    active.current = true;
    const client = getSupabaseBrowserClient();
    const { data: subscription } = client.auth.onAuthStateChange((_event, session) => {
      if (session?.user.id !== userId) {
        active.current = false;
        operation.current?.abort();
        const id = currentDraft.current?.id;
        currentDraft.current = null; setDraft(null); setPhase("blocked");
        setMessage("Sua sessão mudou. Atualize a página para continuar com a conta atual.");
        if (id) void discardAvatarDraft(id).catch(() => {});
      }
    });
    void (async () => {
      try {
        const { data, error } = await client.auth.getUser();
        if (!mounted || !active.current) return;
        if (error || data.user?.id !== userId || data.user.is_anonymous) {
          setMessage("Não foi possível validar esta conta. Atualize a página antes de selecionar uma foto.");
          setPhase("blocked"); return;
        }
        const pending = await loadAvatarDraft(data.user);
        if (!mounted || !active.current) return;
        currentDraft.current = pending; setDraft(pending); setPhase("ready");
      } catch {
        if (mounted && active.current) { setPhase("ready"); setMessage("Selecione uma foto para continuar. O rascunho deste navegador está indisponível."); }
      }
    })();
    return () => { mounted = false; active.current = false; operation.current?.abort(); subscription.subscription.unsubscribe(); };
  }, [userId]);

  useEffect(() => {
    if (!draft) return;
    const url = URL.createObjectURL(draft.file);
    setPreview(url);
    return () => { URL.revokeObjectURL(url); setPreview(null); };
  }, [draft]);

  async function choose(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file || disabled || working.current || !active.current) return;
    const invalid = validateAvatarFile(file);
    if (invalid) { setMessage(invalid); return; }
    working.current = true; setPhase("busy"); setMessage("");
    let selectedId: string | undefined;
    try {
      const { data, error } = await getSupabaseBrowserClient().auth.getUser();
      if (!active.current || error || data.user?.id !== userId || !data.user.email) throw new AvatarUploadError("session");
      const selected = await saveAvatarDraft(file, data.user.email);
      selectedId = selected.id;
      if (!active.current) { await discardAvatarDraft(selected.id); return; }
      const bound = await loadAvatarDraft(data.user);
      if (!active.current || bound?.id !== selected.id) throw new AvatarUploadError("session");
      currentDraft.current = bound; setDraft(bound);
    } catch {
      if (!active.current && selectedId) await discardAvatarDraft(selectedId).catch(() => {});
      if (active.current) setMessage("Não foi possível preparar a foto. Verifique sua sessão e o armazenamento deste navegador.");
    } finally { working.current = false; if (active.current) setPhase("ready"); }
  }

  async function save() {
    const pending = currentDraft.current;
    if (!pending || disabled || working.current || !active.current) return;
    working.current = true; setPhase("busy"); setMessage("");
    const abort = new AbortController(); operation.current = abort;
    const timeout = window.setTimeout(() => abort.abort(), 30000);
    try {
      const client = getSupabaseBrowserClient();
      // Local intent check only. The uploader performs cancellable server-side
      // identity verification before any write; avoid an unbounded extra read.
      const stored = await loadAvatarDraft({ id: userId, email: pending.email });
      if (!active.current || stored?.id !== pending.id) throw new AvatarUploadError("session");
      const url = await uploadAvatarForUser(client, userId, pending.file, pending.id, abort.signal);
      if (!active.current) return;
      await discardAvatarDraft(pending.id).catch(() => {});
      if (!active.current) return;
      if (onSaved) {
        currentDraft.current = null; setDraft(null); setMessage("Foto salva no seu perfil.");
        onSaved(url); return;
      }
      setMessage("Foto confirmada. Atualizando seu painel...");
      // Reload the selector from verified Auth metadata; never rewrite SDK sessions.
      window.location.replace("/dashboard");
    } catch (cause) {
      if (active.current) setMessage(abort.signal.aborted
        ? "A confirmação demorou demais. Tente novamente para verificar a mesma foto, sem reenviar arquivos já recebidos."
        : cause instanceof AvatarUploadError && cause.stage === "session"
        ? "Sua sessão mudou ou expirou. Entre novamente antes de confirmar a foto."
        : "Não foi possível confirmar a foto. Você pode tentar novamente com a mesma seleção ou continuar sem foto. Nenhuma imagem anterior foi apagada.");
    } finally { window.clearTimeout(timeout); working.current = false; if (active.current) setPhase("ready"); }
  }

  async function skip() {
    if (disabled || working.current || !active.current) return;
    working.current = true; setPhase("busy");
    try {
      if (currentDraft.current) await discardAvatarDraft(currentDraft.current.id);
      currentDraft.current = null; setDraft(null); setMessage("Você pode continuar usando sua conta sem enviar uma foto.");
    } catch { setMessage("Não foi possível descartar a seleção neste navegador. Você pode continuar usando o painel."); }
    finally { working.current = false; if (active.current) setPhase("ready"); }
  }

  return <section aria-label="Foto de perfil opcional" aria-busy={phase === "busy" || phase === "loading"}
    className="mt-6 rounded-panel border border-outline bg-surface p-5 sm:p-6">
    <h2 className="text-lg font-semibold text-content">Foto de perfil <span className="text-sm font-normal text-content-muted">(opcional)</span></h2>
    <p className="mt-2 text-sm text-content-muted">Confirme a foto selecionada no cadastro ou escolha outra. A imagem ficará pública. Você pode continuar sem foto.</p>
    {message && <p role="status" className="mt-3 text-sm text-content-muted">{message}</p>}
    {phase === "loading" ? <p role="status" className="mt-3 text-sm text-content-muted">Verificando foto e sessão...</p>
      : phase !== "blocked" && <div className="mt-4 flex flex-wrap items-center gap-3">
        <ProfileAvatar name={draft ? "Foto selecionada" : name} imageUrl={draft ? preview : currentImageUrl} />
        <label className="text-sm text-content-label">{draft ? "Trocar foto" : "Selecionar foto"}
          <input aria-label="Selecionar foto de perfil" className="mt-2 block max-w-full text-sm text-content-muted" type="file"
            accept="image/jpeg,image/png,image/webp" disabled={disabled || phase === "busy"} onChange={event => void choose(event)} />
        </label>
        {draft && <>
          <button type="button" disabled={disabled || phase === "busy"} onClick={() => void save()}
            className="min-h-11 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-on-primary disabled:opacity-60">{phase === "busy" ? "Verificando foto..." : "Confirmar foto"}</button>
          <button type="button" disabled={disabled || phase === "busy"} onClick={() => void skip()}
            className="min-h-11 rounded-xl border border-outline px-4 py-2 text-sm text-content-muted disabled:opacity-60">Continuar sem enviar foto</button>
        </>}
      </div>}
  </section>;
}
