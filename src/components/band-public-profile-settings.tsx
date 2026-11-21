"use client";

import { PUBLIC_IDENTITY_ENABLED } from "@/lib/publication-control";
import PublicationUnavailable from "@/components/publication-unavailable";
import NavigationIcon from "@/components/navigation-icon";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { copyProfileAddress, shareProfileAddress } from "@/lib/profile-sharing";
import { BandPublicationError, getPublicProfilePath, updateBandPublication } from "@/lib/band-publication";

type Props = {
  bandId: string;
  initialSlug: string | null;
  initiallyPublic: boolean;
  isAdmin: boolean;
  renderPreview?: (publicPath: string | null) => ReactNode;
  onPublicationChange?: (value: { slug: string | null; is_public: boolean }) => void;
};

const iconButtonStyles = "inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-brand hover:bg-accent-soft focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-focus disabled:opacity-50";

export default function BandPublicProfileSettings(props: Props) {
  return PUBLIC_IDENTITY_ENABLED ? <EnabledBandPublicProfileSettings {...props} /> : <PublicationUnavailable />;
}

function EnabledBandPublicProfileSettings({ bandId, initialSlug, initiallyPublic, isAdmin, renderPreview, onPublicationChange }: Props) {
  const [isPublic, setIsPublic] = useState(initiallyPublic);
  const [slug, setSlug] = useState(initialSlug);
  const [origin, setOrigin] = useState("");
  const [saving, setSaving] = useState(false);
  const [copying, setCopying] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [copyMessage, setCopyMessage] = useState("");
  const [copyError, setCopyError] = useState("");
  const [addressVisible, setAddressVisible] = useState(false);
  const saveLock = useRef(false);
  const sharingLock = useRef(false);
  const mounted = useRef(false);
  const urlInput = useRef<HTMLInputElement>(null);
  const path = getPublicProfilePath(slug);
  const profileUrl = origin && path ? origin + path : "";
  const visibilityLabel = addressVisible ? "Ocultar endereço público" : "Mostrar endereço público";

  useEffect(() => {
    mounted.current = true;
    setOrigin(window.location.origin);
    return () => { mounted.current = false; };
  }, []);

  useEffect(() => {
    if (addressVisible && copyError) {
      urlInput.current?.focus();
      urlInput.current?.select();
    }
  }, [addressVisible, copyError]);

  async function togglePublication() {
    if (!PUBLIC_IDENTITY_ENABLED) return;
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
        setAddressVisible(true);
        setCopyError("Selecione o endereço acima e use Copiar no menu do navegador.");
      }
    } finally {
      sharingLock.current = false;
      if (mounted.current) setCopying(false);
    }
  }

  return (
    <section aria-labelledby="public-profile-heading" className="min-w-0 md:mt-7">
      <header className="flex min-h-11 items-center justify-between gap-2">
        <h1 id="public-profile-heading" className="text-xl font-semibold tracking-tight text-content sm:text-2xl">Perfil Público</h1>
        <div className="flex shrink-0 items-center gap-1">
          <span id="publication-status" className={`inline-flex items-center gap-1.5 text-xs font-medium ${isPublic ? "text-brand" : "text-content-muted"}`}>
            <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-current" />
            {saving ? "Salvando..." : isPublic ? "Público" : "Privado"}
          </span>
          {isAdmin && (
            <button type="button" role="switch" aria-checked={isPublic} aria-label="Publicar perfil"
              aria-describedby="publication-status" title={isPublic ? "Desativar perfil público" : "Ativar perfil público"}
              onClick={() => void togglePublication()} disabled={saving || copying || (!isPublic && !path)} aria-busy={saving}
              className={iconButtonStyles}>
              <span aria-hidden="true" className={`flex h-5 w-9 items-center rounded-full border border-outline p-0.5 ${isPublic ? "justify-end bg-primary" : "bg-surface-muted"}`}>
                <span className={`h-3.5 w-3.5 rounded-full ${isPublic ? "bg-on-primary" : "bg-content-muted"}`} />
              </span>
            </button>
          )}
        </div>
      </header>

      {renderPreview?.(isPublic && !saving ? path : null)}

      {!path && <p role="alert" className="mb-2 rounded-lg bg-warning-surface p-2 text-sm text-warning-strong">
        Esta banda não possui um endereço público válido. A ativação, a visualização e a cópia ficam indisponíveis.
      </p>}

      {!isAdmin && <p className="mb-2 text-xs text-content-subtle">Somente administradores podem alterar a publicação do perfil.</p>}
      <div role="status" aria-live="polite" className="mb-2 text-sm text-brand empty:sr-only">{success}</div>
      {error && <p role="alert" className="mb-2 rounded-lg bg-danger-surface p-2 text-sm text-danger">{error}</p>}

      {path && (isAdmin || isPublic) && (
        <div className="mt-2 min-w-0">
          <div className="flex min-w-0 items-center rounded-lg bg-surface-muted">
            <div id="public-profile-url" className="min-w-0 flex-1">
              {addressVisible ? (
                <input ref={urlInput} type="text" aria-label="Endereço público" readOnly value={profileUrl}
                  title={profileUrl} onFocus={event => event.currentTarget.select()}
                  className="min-h-11 w-full truncate rounded-lg bg-transparent px-2 text-base text-content-label focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-focus" />
              ) : <p className="truncate px-2 text-sm text-content-muted">Endereço oculto</p>}
            </div>
            <button type="button" aria-controls="public-profile-url" aria-expanded={addressVisible}
              aria-label={visibilityLabel} title={visibilityLabel} className={iconButtonStyles} disabled={!profileUrl}
              onClick={() => {
                setAddressVisible(!addressVisible);
                setCopyError("");
              }}>
              <NavigationIcon name={addressVisible ? "EyeOff" : "Eye"} className="h-4 w-4" />
            </button>
            <button type="button" onClick={() => void copyLink()} disabled={!profileUrl || copying || saving}
              aria-label="Copiar endereço" title="Copiar endereço" className={iconButtonStyles}>
              <NavigationIcon name="Copy" className="h-4 w-4" />
            </button>
            {isPublic && <button type="button" onClick={() => void copyLink(true)}
              disabled={!profileUrl || copying || saving} aria-busy={copying}
              aria-label="Compartilhar" title="Compartilhar" className={iconButtonStyles}>
              <NavigationIcon name="Share" className="h-4 w-4" />
            </button>}
          </div>
          <p role="status" aria-live="polite" className="mt-2 text-sm text-brand empty:sr-only">{copyMessage}</p>
          {copyError && <p role="alert" className="mt-2 text-sm text-danger">{copyError}</p>}
        </div>
      )}
    </section>
  );
}
