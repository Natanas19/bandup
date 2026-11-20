"use client";

import { PUBLICATION_ENABLED } from "@/lib/publication-control";
import LegacyBandLinks from "@/components/legacy-band-links";
import { useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import BandNavigation from "@/components/band-navigation";
import { BandWorkspaceInfo } from "@/components/band-workspace";
import { useParams } from "next/navigation";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { getSafeExternalUrl } from "@/lib/social-links";
import { BandPublicationError, getPublicProfilePath, updateLinkPublication, verifyBandAdmin } from "@/lib/band-publication";

type Platform = "instagram" | "spotify" | "youtube" | "tiktok" | "facebook" | "website" | "other";
type SocialLink = { id: string; platform: string; url: string; created_at: string; is_public: boolean };
type PageState = "loading" | "unauthenticated" | "unavailable" | "error" | "ready";

const platforms: { value: Platform; label: string }[] = [
  { value: "instagram", label: "Instagram" },
  { value: "spotify", label: "Spotify" },
  { value: "youtube", label: "YouTube" },
  { value: "tiktok", label: "TikTok" },
  { value: "facebook", label: "Facebook" },
  { value: "website", label: "Site" },
  { value: "other", label: "Outro" },
];

function getPlatformLabel(platform: string) {
  if (platform === "other") return "Outro";
  return platforms.find((option) => option.value === platform)?.label ?? platform;
}

export default function BandLinksPage() {
  return PUBLICATION_ENABLED ? <EnabledBandLinksPage /> : <LegacyBandLinks />;
}

function EnabledBandLinksPage() {
  const { bandId } = useParams<{ bandId: string }>();
  const [pageState, setPageState] = useState<PageState>("loading");
  const [bandName, setBandName] = useState("");
  const [bandSlug, setBandSlug] = useState<string | null>(null);
  const [bandIsPublic, setBandIsPublic] = useState(false);
  const [publishNewLink, setPublishNewLink] = useState(false);
  const [publishingId, setPublishingId] = useState<string | null>(null);
  const [publicationError, setPublicationError] = useState("");
  const [publicationSuccess, setPublicationSuccess] = useState("");
  const publicationLock = useRef(false);
  const activeBand = useRef<string | null>(bandId);
  const [isAdmin, setIsAdmin] = useState(false);
  const [links, setLinks] = useState<SocialLink[]>([]);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [loadError, setLoadError] = useState("");
  const [formError, setFormError] = useState("");
  const [deleteError, setDeleteError] = useState("");
  const [platform, setPlatform] = useState<Platform>("instagram");
  const [customPlatform, setCustomPlatform] = useState("");
  const [url, setUrl] = useState("");
  const [editingLinkId, setEditingLinkId] = useState<string | null>(null);
  const formRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!isFormOpen || !formRef.current) return;
    formRef.current.focus({ preventScroll: true });
    formRef.current.scrollIntoView({ block: "start", behavior: "auto" });
  }, [isFormOpen, editingLinkId]);

  useEffect(() => {
    let isMounted = true;
    activeBand.current = bandId;

    async function loadLinksPage() {
      setPageState("loading");
      setLoadError("");
      setPublicationError("");
      setPublicationSuccess("");
      setPublishNewLink(false);
      setPublishingId(null);
      setIsAdmin(false);

      try {
        const supabase = getSupabaseBrowserClient();
        const { data: sessionData, error: sessionError } = await supabase.auth.getSession();

        if (!isMounted) return;
        if (sessionError) {
          setPageState("error");
          setLoadError("Não foi possível verificar sua sessão. Tente novamente.");
          return;
        }

        const user = sessionData.session?.user;
        if (!user) {
          setPageState("unauthenticated");
          return;
        }

        const { data: membership, error: membershipError } = await supabase
          .from("band_members")
          .select("role")
          .eq("band_id", bandId)
          .eq("user_id", user.id)
          .maybeSingle();

        if (!isMounted) return;
        if (membershipError) {
          setPageState("error");
          setLoadError("Não foi possível verificar seu acesso à banda. Tente novamente.");
          return;
        }
        if (!membership) {
          setPageState("unavailable");
          return;
        }

        const { data: band, error: bandError } = await supabase
          .from("bands")
          .select("name, slug, is_public")
          .eq("id", bandId)
          .maybeSingle();

        if (!isMounted) return;
        if (bandError || !band) {
          setPageState(bandError ? "error" : "unavailable");
          setLoadError(bandError ? "Não foi possível carregar a banda. Tente novamente." : "");
          return;
        }

        const { data, error: linksError } = await supabase
          .from("social_links")
          .select("id, platform, url, created_at, is_public")
          .eq("band_id", bandId)
          .order("created_at", { ascending: true });

        if (!isMounted) return;
        if (linksError) {
          setPageState("error");
          setLoadError("Não foi possível carregar os links da banda. Tente novamente.");
          return;
        }

        setBandName(band.name);
        setBandSlug(band.slug);
        setBandIsPublic(band.is_public);
        setIsAdmin(membership.role === "admin");
        setLinks((data ?? []) as SocialLink[]);
        setPageState("ready");
      } catch {
        if (isMounted) {
          setPageState("error");
          setLoadError("Não foi possível carregar os links da banda. Tente novamente.");
        }
      }
    }

    void loadLinksPage();
    return () => {
      isMounted = false;
      activeBand.current = null;
    };
  }, [bandId]);

  async function verifyAdmin() {
    return verifyBandAdmin(bandId);
  }

  function openLinkForm(link: SocialLink | null = null) {
    if (!PUBLICATION_ENABLED) return;
    if (!isAdmin || isSubmitting || publishingId !== null || deletingId !== null) return;
    setEditingLinkId(link?.id ?? null);
    const knownPlatform = platforms.some((option) => option.value === link?.platform);
    setPlatform(link && knownPlatform ? link.platform as Platform : link ? "other" : "instagram");
    setCustomPlatform(link && !knownPlatform ? link.platform : "");
    setUrl(link?.url ?? "");
    setPublishNewLink(false);
    setFormError("");
    setIsFormOpen(true);
  }

  function closeLinkForm() {
    setIsFormOpen(false);
    setEditingLinkId(null);
    setFormError("");
  }

  async function handleAddLink(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!PUBLICATION_ENABLED) return;
    if (isSubmitting || publishingId !== null || deletingId !== null) return;

    setFormError("");
    setPublicationSuccess("");
    setPublicationError("");
    if (!editingLinkId && publishNewLink && !getPublicProfilePath(bandSlug)) {
      setFormError("A banda precisa de um endereço válido para selecionar links públicos.");
      return;
    }
    const normalizedPlatform = customPlatform.trim();
    if (platform === "other" && !normalizedPlatform) {
      setFormError("Informe o nome da plataforma.");
      return;
    }

    // Validate raw input before trimming so boundary controls cannot disappear.
    if (!getSafeExternalUrl(url)) {
      setFormError("Informe uma URL HTTP/HTTPS válida, sem credenciais ou caracteres de controle.");
      return;
    }

    const normalizedUrl = url.trim();
    setIsSubmitting(true);
    try {
      const access = await verifyAdmin();
      if (!access) {
        setFormError("Somente administradores da banda podem salvar links.");
        return;
      }

      const values = { platform: platform === "other" ? normalizedPlatform : platform, url: normalizedUrl };
      const result = editingLinkId
        ? await access.supabase.from("social_links").update(values)
          .eq("id", editingLinkId).eq("band_id", bandId)
          .select("id, platform, url, created_at, is_public").maybeSingle()
        : await access.supabase.from("social_links")
          .insert({ ...values, band_id: bandId, is_public: publishNewLink })
          .select("id, platform, url, created_at, is_public").single();
      const { data, error } = result;
      if (error || !data || (editingLinkId ? data.id !== editingLinkId : data.is_public !== publishNewLink)) {
        setFormError("N\u00e3o foi poss\u00edvel salvar o link. Confira a URL e tente novamente.");
        return;
      }
      setLinks((currentLinks) => editingLinkId
        ? currentLinks.map((link) => link.id === editingLinkId ? data as SocialLink : link)
        : [...currentLinks, data as SocialLink]);
      setPublicationSuccess(editingLinkId ? "Link atualizado e confirmado." : "Link cadastrado e visibilidade confirmada.");
      setEditingLinkId(null);
      setUrl("");
      setPlatform("instagram");
      setCustomPlatform("");
      setPublishNewLink(false);
      setIsFormOpen(false);
    } catch {
      setFormError("Não foi possível salvar o link agora. Tente novamente.");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handlePublicationChange(link: SocialLink) {
    if (!PUBLICATION_ENABLED) return;
    if (!isAdmin || publicationLock.current || isSubmitting || deletingId) return;
    const nextValue = !link.is_public;
    if (nextValue && !getSafeExternalUrl(link.url)) {
      setPublicationError("Corrija a URL insegura antes de publicar este link.");
      return;
    }
    if (nextValue && !getPublicProfilePath(bandSlug)) return;
    publicationLock.current = true;
    setPublishingId(link.id);
    setPublicationError("");
    setPublicationSuccess("");
    try {
      const confirmed = await updateLinkPublication(bandId, link.id, link.is_public, nextValue);
      if (activeBand.current !== bandId) return;
      setLinks((currentLinks) => currentLinks.map((currentLink) =>
        currentLink.id === link.id ? { ...currentLink, is_public: confirmed.is_public } : currentLink
      ));
      setPublicationSuccess(confirmed.is_public
        ? "Link selecionado para o perfil público. Ele aparece quando o perfil da banda está ativado."
        : "Link removido do perfil público. Ele continua disponível aos integrantes.");
    } catch (cause) {
      if (activeBand.current === bandId) setPublicationError(
        cause instanceof BandPublicationError ? cause.message : "Não foi possível confirmar a visibilidade. Recarregue a página.",
      );
    } finally {
      publicationLock.current = false;
      if (activeBand.current === bandId) setPublishingId(null);
    }
  }

  async function handleDeleteLink(link: SocialLink) {
    if (!PUBLICATION_ENABLED) return;
    if (deletingId || publishingId !== null || isSubmitting || !window.confirm(`Excluir o link ${getPlatformLabel(link.platform)}?`)) return;

    setDeleteError("");
    setDeletingId(link.id);
    try {
      const access = await verifyAdmin();
      if (!access) {
        setDeleteError("Somente administradores da banda podem excluir links.");
        return;
      }

      const { data: deletedLink, error } = await access.supabase
        .from("social_links")
        .delete()
        .eq("id", link.id)
        .eq("band_id", bandId)
        .select("id")
        .maybeSingle();

      if (error || !deletedLink) {
        setDeleteError("Não foi possível excluir o link. Tente novamente.");
        return;
      }

      setLinks((currentLinks) => currentLinks.filter((currentLink) => currentLink.id !== link.id));
      if (editingLinkId === link.id) closeLinkForm();
    } catch {
      setDeleteError("Não foi possível excluir o link agora. Tente novamente.");
    } finally {
      setDeletingId(null);
    }
  }

  if (pageState !== "ready") {
    return (
      <main className="flex flex-1 justify-center px-4 py-8 sm:px-6 sm:py-12">
        <section className="w-full max-w-3xl">
          <Link href={`/bandas/${bandId}`} className="inline-flex min-h-11 items-center rounded-xl border border-accent-border px-4 py-2.5 text-sm font-semibold text-brand transition hover:bg-accent-soft focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-focus">
            ← Voltar para a banda
          </Link>
          <div className="mt-6 rounded-3xl border border-nav-border bg-surface p-8 text-center shadow-app-dashboard sm:p-10">
            {pageState === "loading" ? (
              <p className="text-content-muted">Carregando links...</p>
            ) : pageState === "unauthenticated" ? (
              <>
                <h1 className="text-2xl font-semibold text-content">Entre para continuar</h1>
                <p className="mt-3 text-sm text-content-muted">Faça login para acessar os links da banda.</p>
                <Link href="/login" className="mt-6 inline-flex min-h-11 items-center rounded-xl bg-primary px-5 py-3 text-sm font-semibold text-on-primary transition hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-focus">Ir para o login</Link>
              </>
            ) : pageState === "unavailable" ? (
              <>
                <h1 className="text-2xl font-semibold text-content">Banda não encontrada</h1>
                <p className="mt-3 text-sm text-content-muted">Essa banda não existe ou você não tem acesso a ela.</p>
              </>
            ) : (
              <p role="alert" className="text-sm text-danger">{loadError}</p>
            )}
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="flex flex-1 justify-center px-4 pb-6 pt-5 sm:px-6 sm:pb-10 sm:pt-8 md:pt-10">
      <div className="w-full max-w-5xl min-w-0">
        <BandWorkspaceInfo name={bandName} role={isAdmin ? "admin" : "member"} />
        <div className="md:hidden"><BandNavigation bandId={bandId} activeSection="links" /></div>

        <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between md:mt-7">
          <div className="min-w-0">
            <p className="text-xs font-semibold tracking-[0.16em] text-accent uppercase">{bandName}</p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight text-content sm:text-4xl">Links</h1>
            <p className="mt-2 text-sm leading-6 text-content-muted">Gerencie os links da banda e escolha quais aparecem no perfil público.</p>
          </div>
          {isAdmin && (
            <button
              type="button"
              onClick={() => { if (isFormOpen) closeLinkForm(); else openLinkForm(); }}
              aria-expanded={isFormOpen}
              aria-controls="link-form"
              disabled={isSubmitting || publishingId !== null || deletingId !== null}
              className="inline-flex min-h-11 w-full shrink-0 items-center justify-center rounded-xl bg-primary px-5 py-3 text-sm font-semibold text-on-primary shadow-lg shadow-primary/15 transition hover:bg-primary-hover focus:outline-none focus:ring-4 focus:ring-focus disabled:cursor-not-allowed disabled:opacity-70 sm:w-auto"
            >
              {isFormOpen ? "Fechar formulário" : "+ Adicionar link"}
            </button>
          )}
        </header>

        {isAdmin && isFormOpen && (
          <section id="link-form" ref={formRef} tabIndex={-1} aria-labelledby="link-form-heading" className="mt-6 scroll-mt-6 rounded-2xl outline-none border border-nav-border bg-surface p-5 shadow-app-form sm:p-7">
            <h2 id="link-form-heading" className="mb-5 text-lg font-semibold text-content">{editingLinkId ? "Editar link" : "Adicionar link"}</h2>
            <form onSubmit={handleAddLink} className="space-y-5">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label htmlFor="link-platform" className="mb-2 block text-sm font-medium text-content-label">Plataforma</label>
                  <select
                    id="link-platform"
                    value={platform}
                    onChange={(event) => {
                      const selectedPlatform = event.target.value as Platform;
                      setPlatform(selectedPlatform);
                      if (selectedPlatform !== "other") setCustomPlatform("");
                    }}
                    disabled={isSubmitting}
                    className="min-h-11 w-full rounded-xl border border-outline bg-surface px-3 py-2.5 text-base md:text-sm text-content outline-none focus:border-input-focus focus:ring-4 focus:ring-input-ring"
                  >
                    {platforms.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </select>
                </div>
                {platform === "other" && (
                  <div>
                    <label htmlFor="custom-platform" className="mb-2 block text-sm font-medium text-content-label">Nome da plataforma *</label>
                    <input
                      id="custom-platform"
                      type="text"
                      required
                      maxLength={100}
                      value={customPlatform}
                      onChange={(event) => setCustomPlatform(event.target.value)}
                      disabled={isSubmitting}
                      placeholder="Ex.: SoundCloud"
                      className="min-h-11 w-full rounded-xl border border-outline bg-surface px-4 py-3 text-base md:text-sm text-content outline-none transition placeholder:text-content-faint focus:border-input-focus focus:ring-4 focus:ring-input-ring"
                    />
                  </div>
                )}
                <div>
                  <label htmlFor="link-url" className="mb-2 block text-sm font-medium text-content-label">URL *</label>
                  <input id="link-url" type="url" required maxLength={2000} value={url} onChange={(event) => setUrl(event.target.value)} disabled={isSubmitting} placeholder="https://..." className="min-h-11 w-full rounded-xl border border-outline bg-surface px-4 py-3 text-base md:text-sm text-content outline-none transition placeholder:text-content-faint focus:border-input-focus focus:ring-4 focus:ring-input-ring" />
                </div>
              </div>

              {!editingLinkId && <div className="rounded-xl border border-nav-border bg-accent-soft/50 p-4">
                <label className="flex min-h-11 items-center gap-3 text-sm font-medium text-content-strong">
                  <input type="checkbox" checked={publishNewLink}
                    onChange={(event) => setPublishNewLink(event.target.checked)}
                    disabled={isSubmitting || !getPublicProfilePath(bandSlug)}
                    aria-describedby="new-link-publication-help"
                    className="h-5 w-5 shrink-0 accent-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent" />
                  Exibir no perfil público
                </label>
                <p id="new-link-publication-help" className="mt-2 text-sm leading-6 text-content-muted">
                  Novos links ficam privados por padrão. Um link selecionado só aparece publicamente quando o perfil da banda está ativado.
                </p>
              </div>}

              {formError && <p role="alert" className="rounded-xl border border-danger-border bg-danger-surface px-4 py-3 text-sm text-danger">{formError}</p>}

              <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
                <button type="button" disabled={isSubmitting} onClick={closeLinkForm} className="min-h-11 rounded-xl border border-accent-border px-5 py-3 text-sm font-semibold text-brand hover:bg-accent-soft focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-focus disabled:opacity-60">Cancelar</button>
                <button type="submit" disabled={isSubmitting} className="inline-flex min-h-11 w-full items-center justify-center rounded-xl bg-primary px-5 py-3 text-sm font-semibold text-on-primary transition hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-focus disabled:cursor-not-allowed disabled:opacity-70 sm:w-auto">
                  {isSubmitting ? "Salvando link..." : "Salvar link"}
                </button>
              </div>
            </form>
          </section>
        )}





        <section aria-label="Visibilidade dos links" className="mt-5 rounded-2xl border border-nav-border bg-accent-soft/50 p-4 text-sm leading-6 text-content-label">
          <p>{bandIsPublic
            ? "O perfil da banda está ativado. Somente os links selecionados abaixo aparecem publicamente."
            : "O perfil da banda está desativado. A seleção dos links fica guardada, mas nenhum é exibido publicamente."}</p>
          {!getPublicProfilePath(bandSlug) && <p className="mt-2 text-warning-strong">A banda não possui um endereço público válido. Você pode ocultar links já selecionados, mas não selecionar novos.</p>}
          {!isAdmin && <p className="mt-2 text-content-subtle">Somente administradores podem alterar a visibilidade dos links.</p>}
        </section>
        <p role="status" aria-live="polite" className="mt-3 text-sm text-brand">{publicationSuccess}</p>
        {publicationError && <p role="alert" className="mt-3 rounded-xl border border-danger-border bg-danger-surface p-3 text-sm text-danger">{publicationError}</p>}

        {!isFormOpen && formError && <p role="alert" className="mt-5 rounded-xl border border-danger-border bg-danger-surface px-4 py-3 text-sm text-danger">{formError}</p>}
        {deleteError && <p role="alert" className="mt-5 rounded-xl border border-danger-border bg-danger-surface px-4 py-3 text-sm text-danger">{deleteError}</p>}

        {links.length === 0 ? (
          <section id="band-links" className="mt-7 scroll-mt-6 rounded-2xl border border-dashed border-accent-border bg-surface px-5 py-10 text-center sm:py-14">
            <h2 className="text-lg font-semibold text-content">Ainda não há links cadastrados.</h2>
            <p className="mt-2 text-sm text-content-muted">Cadastre um link para começar. A publicação de cada link é opcional e fica desativada por padrão.</p>
          </section>
        ) : (
          <section id="band-links" className="mt-7 scroll-mt-6 space-y-3" aria-label="Links da banda">
            {links.map((link) => {
              const safeUrl = getSafeExternalUrl(link.url);
              return (
              <article key={link.id} className="flex min-w-0 flex-col gap-3 rounded-2xl border border-nav-border bg-surface p-4 shadow-app-card sm:flex-row sm:items-center sm:justify-between sm:p-5">
                <div className="min-w-0">
                  <p className="text-xs font-semibold tracking-wide text-accent uppercase">{getPlatformLabel(link.platform)}</p>
                  {safeUrl ? (
                    <a href={safeUrl} target="_blank" rel="noopener noreferrer" className="mt-1 block break-all text-sm font-medium text-content-strong underline decoration-accent-outline-hover underline-offset-4 hover:text-brand focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-focus sm:text-base">{link.url}</a>
                  ) : (
                    <p className="mt-1 break-all text-sm text-content-label sm:text-base">{link.url}</p>
                  )}
                  <span className="mt-2 inline-flex w-fit rounded-full bg-accent-soft px-3 py-1 text-xs font-medium text-brand">
                    {!safeUrl ? "URL insegura: edite ou oculte este link" : link.is_public ? bandIsPublic ? "Exibido no perfil público" : "Selecionado · perfil desativado" : "Somente integrantes"}
                  </span>
                </div>
                {isAdmin && (
                  <div className="flex w-full flex-col gap-2 sm:w-auto sm:shrink-0">
                    <button type="button" onClick={() => openLinkForm(link)} disabled={deletingId !== null || publishingId !== null || isSubmitting}
                      className="inline-flex min-h-11 w-full items-center justify-center rounded-xl border border-accent-border px-4 py-2.5 text-sm font-semibold text-brand transition hover:bg-accent-soft focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-focus disabled:cursor-not-allowed disabled:opacity-60">Editar</button>
                    <button type="button" role="switch" aria-checked={link.is_public}
                      aria-label={`Exibir no perfil público: ${getPlatformLabel(link.platform)} — ${link.url}`}
                      aria-busy={publishingId === link.id}
                      onClick={() => void handlePublicationChange(link)}
                      disabled={publishingId !== null || deletingId !== null || isSubmitting || (!link.is_public && (!getPublicProfilePath(bandSlug) || !safeUrl))}
                      className="inline-flex min-h-11 w-full items-center justify-center rounded-xl border border-accent-border px-4 py-2.5 text-sm font-semibold text-brand transition hover:bg-accent-soft focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-focus disabled:cursor-not-allowed disabled:opacity-60">
                      {publishingId === link.id ? "Salvando..." : link.is_public ? "Ocultar do perfil" : "Exibir no perfil"}
                    </button>
                    <button type="button" onClick={() => void handleDeleteLink(link)} disabled={deletingId !== null || publishingId !== null || isSubmitting} className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-xl border border-danger-border px-4 py-2.5 text-sm font-semibold text-danger transition hover:bg-danger-surface focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-focus disabled:cursor-not-allowed disabled:opacity-60">
                      {deletingId === link.id ? "Excluindo..." : "Excluir"}
                    </button>
                  </div>
                )}
              </article>
              );
            })}
          </section>
        )}
      </div>
    </main>
  );
}
