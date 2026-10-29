"use client";

import { PUBLICATION_ENABLED } from "@/lib/publication-control";
import PublicationUnavailable from "@/components/publication-unavailable";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { copyProfileAddress, shareProfileAddress } from "@/lib/profile-sharing";
import { BandPublicationError, getPublicProfilePath, updateBandPublication } from "@/lib/band-publication";

type Props = {
  bandId: string;
  initialSlug: string | null;
  initiallyPublic: boolean;
  isAdmin: boolean;
  onPublicationChange?: (value: { slug: string | null; is_public: boolean }) => void;
  linksHref?: string;
};

const buttonStyles = "inline-flex min-h-11 w-full items-center justify-center rounded-xl border border-accent-border px-4 py-3 text-sm font-semibold text-brand transition hover:bg-accent-soft focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-focus disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto";

export default function BandPublicProfileSettings(props: Props) {
  return PUBLICATION_ENABLED ? <EnabledBandPublicProfileSettings {...props} /> : <PublicationUnavailable />;
}

function EnabledBandPublicProfileSettings({ bandId, initialSlug, initiallyPublic, isAdmin, onPublicationChange, linksHref }: Props) {
  const [isPublic, setIsPublic] = useState(initiallyPublic);
  const [slug, setSlug] = useState(initialSlug);
  const [origin, setOrigin] = useState("");
  const [saving, setSaving] = useState(false);
  const [copying, setCopying] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [copyMessage, setCopyMessage] = useState("");
  const [copyError, setCopyError] = useState("");
  const saveLock = useRef(false);
  const sharingLock = useRef(false);
  const mounted = useRef(false);
  const urlInput = useRef<HTMLInputElement>(null);
  const path = getPublicProfilePath(slug);
  const profileUrl = origin && path ? origin + path : "";

  useEffect(() => {
    mounted.current = true;
    setOrigin(window.location.origin);
    return () => { mounted.current = false; };
  }, []);

  async function togglePublication() {
    if (!PUBLICATION_ENABLED) return;
    if (!isAdmin || saveLock.current || sharingLock.current || (!isPublic && !path)) return;
    saveLock.current = true;
    setSaving(true);
    setError("");
    setSuccess("");
    setCopyMessage("");
    setCopyError("");
    try {
      const confirmed = await updateBandPublication(bandId, !isPublic);
      if (!mounted.current) return;
      setIsPublic(confirmed.is_public);
      setSlug(confirmed.slug);
      onPublicationChange?.(confirmed);
      setSuccess(confirmed.is_public ? "Perfil público ativado e confirmado." : "Perfil público desativado e confirmado.");
    } catch (cause) {
      if (mounted.current) setError(cause instanceof BandPublicationError ? cause.message : "Não foi possível confirmar o perfil público. Recarregue a página.");
    } finally {
      saveLock.current = false;
      if (mounted.current) setSaving(false);
    }
  }

  async function copyLink(share = false) {
    if (!profileUrl || sharingLock.current || saveLock.current || (share && !isPublic)) return;
    sharingLock.current = true;
    setCopying(true);
    setCopyMessage("");
    setCopyError("");
    try {
      const result = await (share ? shareProfileAddress : copyProfileAddress)(profileUrl, navigator);
      if (!mounted.current) return;
      if (result === "copied") setCopyMessage("Endereço copiado.");
      if (result === "shared") setCopyMessage("Endereço enviado ao compartilhamento.");
      if (result === "manual") {
        setCopyError("Selecione o endereço acima e use Copiar no menu do navegador.");
        urlInput.current?.focus();
        urlInput.current?.select();
        urlInput.current?.setSelectionRange(0, profileUrl.length);
      }
    } finally {
      sharingLock.current = false;
      if (mounted.current) setCopying(false);
    }
  }

  return (
    <section aria-labelledby="public-profile-heading" className="mt-7 min-w-0 rounded-2xl border border-nav-border bg-surface p-5 shadow-app-card sm:p-6">
      <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h2 id="public-profile-heading" className="text-lg font-semibold text-content">Perfil Público</h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-content-muted">
            Ao ativar, o nome, a descrição, a imagem disponível e os links selecionados poderão ser vistos por qualquer pessoa com o endereço.
          </p>
        </div>
        <span className="w-fit shrink-0 rounded-full bg-accent-soft px-3 py-1.5 text-xs font-semibold text-brand">
          {isPublic ? "Ativado" : "Desativado"}
        </span>
      </div>

      <p id="publication-help" className="mt-4 text-sm leading-6 text-content-muted">
        {isPublic
          ? "Somente os links marcados para exibição aparecem no perfil. Sem links selecionados, o perfil mostra apenas os dados públicos da banda."
          : "O perfil está privado. Os links selecionados ficam guardados, mas não aparecem publicamente enquanto o perfil estiver desativado."}
      </p>

      {!path && <p role="alert" className="mt-4 rounded-xl border border-warning-border bg-warning-surface p-3 text-sm text-warning-strong">
        Esta banda não possui um endereço público válido. A ativação, a visualização e a cópia ficam indisponíveis. Nenhum endereço será gerado automaticamente.
      </p>}

      {isAdmin ? (
        <button type="button" role="switch" aria-checked={isPublic} aria-describedby="publication-help"
          onClick={() => void togglePublication()} disabled={saving || copying || (!isPublic && !path)} aria-busy={saving}
          className={buttonStyles + " mt-4"}>
          {saving ? "Salvando..." : isPublic ? "Desativar perfil público" : "Ativar perfil público"}
        </button>
      ) : <p className="mt-4 text-sm text-content-subtle">Somente administradores podem alterar a publicação do perfil e dos links.</p>}

      <div role="status" aria-live="polite" className="mt-3 text-sm text-brand">{success}</div>
      {error && <p role="alert" className="mt-3 rounded-xl border border-danger-border bg-danger-surface p-3 text-sm text-danger">{error}</p>}

      {path && (isAdmin || isPublic) && (
        <div className="mt-5 min-w-0 border-t border-nav-border pt-5">
          <label htmlFor="public-profile-url" className="block text-sm font-medium text-content-label">Endereço do perfil</label>
          <input ref={urlInput} id="public-profile-url" type="text" readOnly value={profileUrl}
            placeholder="Preparando endereço..." onFocus={(event) => event.currentTarget.select()}
            className="mt-2 min-h-11 w-full min-w-0 rounded-xl border border-outline bg-surface-muted px-3 py-3 text-base text-content-label focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-focus" />
          <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
            {isPublic && !saving ? (
              <a href={path} target="_blank" rel="noopener noreferrer" className={buttonStyles}>Visualizar perfil</a>
            ) : <button type="button" disabled className={buttonStyles}>Visualizar perfil</button>}
            <button type="button" onClick={() => void copyLink()} disabled={!profileUrl || copying || saving} className={buttonStyles}>
              Copiar endereço
            </button>
            {isPublic && <button type="button" onClick={() => void copyLink(true)}
              disabled={!profileUrl || copying || saving} aria-busy={copying} className={buttonStyles}>
              Compartilhar
            </button>}
            {isAdmin && <Link href={linksHref ?? `/bandas/${bandId}/links`} className={buttonStyles}>Gerenciar links</Link>}
          </div>
          {!isPublic && <p className="mt-3 text-sm text-content-subtle">O endereço só exibirá o perfil depois da ativação.</p>}
          <p role="status" aria-live="polite" className="mt-3 text-sm text-brand">{copyMessage}</p>
          {copyError && <p role="alert" className="mt-2 text-sm text-danger">{copyError}</p>}
        </div>
      )}
    </section>
  );
}
