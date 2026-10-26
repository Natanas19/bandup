"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { copyProfileAddress, shareProfileAddress } from "@/lib/profile-sharing";
import { BandPublicationError, getPublicProfilePath, updateBandPublication } from "@/lib/band-publication";

type Props = {
  bandId: string;
  initialSlug: string | null;
  initiallyPublic: boolean;
  isAdmin: boolean;
};

const buttonStyles = "inline-flex min-h-11 w-full items-center justify-center rounded-xl border border-violet-200 px-4 py-3 text-sm font-semibold text-violet-800 transition hover:bg-violet-50 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-violet-200 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto";

export default function BandPublicProfileSettings({ bandId, initialSlug, initiallyPublic, isAdmin }: Props) {
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
    <section aria-labelledby="public-profile-heading" className="mt-7 min-w-0 rounded-2xl border border-violet-100 bg-white p-5 shadow-[0_12px_36px_-28px_rgba(54,36,104,0.35)] sm:p-6">
      <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h2 id="public-profile-heading" className="text-lg font-semibold text-zinc-900">Perfil Público</h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-600">
            Ao ativar, o nome, a descrição, a imagem disponível e os links selecionados poderão ser vistos por qualquer pessoa com o endereço.
          </p>
        </div>
        <span className="w-fit shrink-0 rounded-full bg-violet-50 px-3 py-1.5 text-xs font-semibold text-violet-800">
          {isPublic ? "Ativado" : "Desativado"}
        </span>
      </div>

      <p id="publication-help" className="mt-4 text-sm leading-6 text-zinc-600">
        {isPublic
          ? "Somente os links marcados para exibição aparecem no perfil. Sem links selecionados, o perfil mostra apenas os dados públicos da banda."
          : "O perfil está privado. Os links selecionados ficam guardados, mas não aparecem publicamente enquanto o perfil estiver desativado."}
      </p>

      {!path && <p role="alert" className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
        Esta banda não possui um endereço público válido. A ativação, a visualização e a cópia ficam indisponíveis. Nenhum endereço será gerado automaticamente.
      </p>}

      {isAdmin ? (
        <button type="button" role="switch" aria-checked={isPublic} aria-describedby="publication-help"
          onClick={() => void togglePublication()} disabled={saving || copying || (!isPublic && !path)} aria-busy={saving}
          className={buttonStyles + " mt-4"}>
          {saving ? "Salvando..." : isPublic ? "Desativar perfil público" : "Ativar perfil público"}
        </button>
      ) : <p className="mt-4 text-sm text-zinc-500">Somente administradores podem alterar a publicação do perfil e dos links.</p>}

      <div role="status" aria-live="polite" className="mt-3 text-sm text-violet-800">{success}</div>
      {error && <p role="alert" className="mt-3 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}

      {path && (isAdmin || isPublic) && (
        <div className="mt-5 min-w-0 border-t border-violet-100 pt-5">
          <label htmlFor="public-profile-url" className="block text-sm font-medium text-zinc-700">Endereço do perfil</label>
          <input ref={urlInput} id="public-profile-url" type="text" readOnly value={profileUrl}
            placeholder="Preparando endereço..." onFocus={(event) => event.currentTarget.select()}
            className="mt-2 min-h-11 w-full min-w-0 rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-3 text-base text-zinc-700 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-violet-200" />
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
            {isAdmin && <Link href={`/bandas/${bandId}/links`} className={buttonStyles}>Gerenciar links públicos</Link>}
          </div>
          {!isPublic && <p className="mt-3 text-sm text-zinc-500">O endereço só exibirá o perfil depois da ativação.</p>}
          <p role="status" aria-live="polite" className="mt-3 text-sm text-violet-800">{copyMessage}</p>
          {copyError && <p role="alert" className="mt-2 text-sm text-red-700">{copyError}</p>}
        </div>
      )}
    </section>
  );
}
