"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

type Platform = "instagram" | "spotify" | "youtube" | "tiktok" | "facebook" | "website" | "other";
type SocialLink = { id: string; platform: string; url: string; created_at: string };
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

function isValidHttpUrl(value: string) {
  try {
    const url = new URL(value.trim());
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export default function BandLinksPage() {
  const { bandId } = useParams<{ bandId: string }>();
  const [pageState, setPageState] = useState<PageState>("loading");
  const [bandName, setBandName] = useState("");
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

  useEffect(() => {
    let isMounted = true;

    async function loadLinksPage() {
      setPageState("loading");
      setLoadError("");

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
          .select("name")
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
          .select("id, platform, url, created_at")
          .eq("band_id", bandId)
          .order("created_at", { ascending: true });

        if (!isMounted) return;
        if (linksError) {
          setPageState("error");
          setLoadError("Não foi possível carregar os links da banda. Tente novamente.");
          return;
        }

        setBandName(band.name);
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
    };
  }, [bandId]);

  async function verifyAdmin() {
    const supabase = getSupabaseBrowserClient();
    const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
    const user = sessionData.session?.user;
    if (sessionError || !user) return null;

    const { data: membership, error: membershipError } = await supabase
      .from("band_members")
      .select("role")
      .eq("band_id", bandId)
      .eq("user_id", user.id)
      .maybeSingle();

    if (membershipError || membership?.role !== "admin") return null;
    return { supabase, user };
  }

  async function handleAddLink(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSubmitting) return;

    setFormError("");
    const normalizedPlatform = customPlatform.trim();
    if (platform === "other" && !normalizedPlatform) {
      setFormError("Informe o nome da plataforma.");
      return;
    }

    const normalizedUrl = url.trim();
    if (!isValidHttpUrl(normalizedUrl)) {
      setFormError("Informe uma URL válida iniciada por http:// ou https://.");
      return;
    }

    setIsSubmitting(true);
    try {
      const access = await verifyAdmin();
      if (!access) {
        setFormError("Somente administradores da banda podem adicionar links.");
        return;
      }

      const { data, error } = await access.supabase
        .from("social_links")
        .insert({ band_id: bandId, platform: platform === "other" ? normalizedPlatform : platform, url: normalizedUrl })
        .select("id, platform, url, created_at")
        .single();

      if (error || !data) {
        setFormError("Não foi possível adicionar o link. Confira a URL e tente novamente.");
        return;
      }

      setLinks((currentLinks) => [...currentLinks, data as SocialLink]);
      setUrl("");
      setPlatform("instagram");
      setCustomPlatform("");
      setIsFormOpen(false);
    } catch {
      setFormError("Não foi possível adicionar o link agora. Tente novamente.");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleDeleteLink(link: SocialLink) {
    if (deletingId || !window.confirm(`Excluir o link ${getPlatformLabel(link.platform)}?`)) return;

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
          <Link href={`/bandas/${bandId}`} className="inline-flex min-h-11 items-center rounded-xl border border-violet-200 px-4 py-2.5 text-sm font-semibold text-violet-800 transition hover:bg-violet-50">
            ← Voltar para a banda
          </Link>
          <div className="mt-6 rounded-3xl border border-violet-100 bg-white p-8 text-center shadow-[0_20px_60px_-32px_rgba(54,36,104,0.28)] sm:p-10">
            {pageState === "loading" ? (
              <p className="text-zinc-600">Carregando links...</p>
            ) : pageState === "unauthenticated" ? (
              <>
                <h1 className="text-2xl font-semibold text-zinc-900">Entre para continuar</h1>
                <p className="mt-3 text-sm text-zinc-600">Faça login para acessar os links da banda.</p>
                <Link href="/login" className="mt-6 inline-flex min-h-11 items-center rounded-xl bg-violet-700 px-5 py-3 text-sm font-semibold text-white transition hover:bg-violet-800">Ir para o login</Link>
              </>
            ) : pageState === "unavailable" ? (
              <>
                <h1 className="text-2xl font-semibold text-zinc-900">Banda não encontrada</h1>
                <p className="mt-3 text-sm text-zinc-600">Essa banda não existe ou você não tem acesso a ela.</p>
              </>
            ) : (
              <p role="alert" className="text-sm text-red-700">{loadError}</p>
            )}
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="flex flex-1 justify-center px-4 py-6 sm:px-6 sm:py-10">
      <div className="w-full max-w-5xl min-w-0">
        <Link href={`/bandas/${bandId}`} className="inline-flex min-h-11 items-center rounded-xl border border-violet-200 px-4 py-2.5 text-sm font-semibold text-violet-800 transition hover:bg-violet-50 focus:outline-none focus:ring-4 focus:ring-violet-100">
          ← Voltar para a visão geral
        </Link>

        <header className="mt-7 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0">
            <p className="text-xs font-semibold tracking-[0.16em] text-violet-700 uppercase">{bandName}</p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight text-zinc-900 sm:text-4xl">Links</h1>
            <p className="mt-2 text-sm leading-6 text-zinc-600">Acesse os links públicos da banda.</p>
          </div>
          {isAdmin && (
            <button
              type="button"
              onClick={() => { setFormError(""); setIsFormOpen((isOpen) => !isOpen); }}
              disabled={isSubmitting}
              className="inline-flex min-h-11 w-full shrink-0 items-center justify-center rounded-xl bg-violet-700 px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-violet-700/15 transition hover:bg-violet-800 focus:outline-none focus:ring-4 focus:ring-violet-200 disabled:cursor-not-allowed disabled:opacity-70 sm:w-auto"
            >
              {isFormOpen ? "Fechar formulário" : "+ Adicionar link"}
            </button>
          )}
        </header>

        {isAdmin && isFormOpen && (
          <section className="mt-6 rounded-2xl border border-violet-100 bg-white p-5 shadow-[0_16px_48px_-32px_rgba(54,36,104,0.35)] sm:p-7">
            <h2 className="mb-5 text-lg font-semibold text-zinc-900">Adicionar link</h2>
            <form onSubmit={handleAddLink} className="space-y-5">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label htmlFor="link-platform" className="mb-2 block text-sm font-medium text-zinc-700">Plataforma</label>
                  <select
                    id="link-platform"
                    value={platform}
                    onChange={(event) => {
                      const selectedPlatform = event.target.value as Platform;
                      setPlatform(selectedPlatform);
                      if (selectedPlatform !== "other") setCustomPlatform("");
                    }}
                    disabled={isSubmitting}
                    className="min-h-11 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2.5 text-base md:text-sm text-zinc-900 outline-none focus:border-violet-500 focus:ring-4 focus:ring-violet-100"
                  >
                    {platforms.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </select>
                </div>
                {platform === "other" && (
                  <div>
                    <label htmlFor="custom-platform" className="mb-2 block text-sm font-medium text-zinc-700">Nome da plataforma *</label>
                    <input
                      id="custom-platform"
                      type="text"
                      required
                      maxLength={100}
                      value={customPlatform}
                      onChange={(event) => setCustomPlatform(event.target.value)}
                      disabled={isSubmitting}
                      placeholder="Ex.: SoundCloud"
                      className="min-h-11 w-full rounded-xl border border-zinc-200 px-4 py-3 text-base md:text-sm text-zinc-900 outline-none transition placeholder:text-zinc-400 focus:border-violet-500 focus:ring-4 focus:ring-violet-100"
                    />
                  </div>
                )}
                <div>
                  <label htmlFor="link-url" className="mb-2 block text-sm font-medium text-zinc-700">URL *</label>
                  <input id="link-url" type="url" required maxLength={2000} value={url} onChange={(event) => setUrl(event.target.value)} disabled={isSubmitting} placeholder="https://..." className="min-h-11 w-full rounded-xl border border-zinc-200 px-4 py-3 text-base md:text-sm text-zinc-900 outline-none transition placeholder:text-zinc-400 focus:border-violet-500 focus:ring-4 focus:ring-violet-100" />
                </div>
              </div>

              {formError && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{formError}</p>}

              <div className="flex justify-end">
                <button type="submit" disabled={isSubmitting} className="inline-flex min-h-11 w-full items-center justify-center rounded-xl bg-violet-700 px-5 py-3 text-sm font-semibold text-white transition hover:bg-violet-800 disabled:cursor-not-allowed disabled:opacity-70 sm:w-auto">
                  {isSubmitting ? "Salvando link..." : "Salvar link"}
                </button>
              </div>
            </form>
          </section>
        )}

        {!isFormOpen && formError && <p role="alert" className="mt-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{formError}</p>}
        {deleteError && <p role="alert" className="mt-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{deleteError}</p>}

        {links.length === 0 ? (
          <section className="mt-7 rounded-2xl border border-dashed border-violet-200 bg-white px-5 py-10 text-center sm:py-14">
            <h2 className="text-lg font-semibold text-zinc-900">Ainda não há links cadastrados.</h2>
            <p className="mt-2 text-sm text-zinc-600">Os links públicos da banda aparecerão aqui.</p>
          </section>
        ) : (
          <section aria-label="Links da banda" className="mt-7 space-y-3">
            {links.map((link) => (
              <article key={link.id} className="flex min-w-0 flex-col gap-3 rounded-2xl border border-violet-100 bg-white p-4 shadow-[0_12px_36px_-28px_rgba(54,36,104,0.35)] sm:flex-row sm:items-center sm:justify-between sm:p-5">
                <div className="min-w-0">
                  <p className="text-xs font-semibold tracking-wide text-violet-700 uppercase">{getPlatformLabel(link.platform)}</p>
                  {isValidHttpUrl(link.url) ? (
                    <a href={link.url} target="_blank" rel="noopener noreferrer" className="mt-1 block break-all text-sm font-medium text-zinc-800 underline decoration-violet-300 underline-offset-4 hover:text-violet-800 sm:text-base">{link.url}</a>
                  ) : (
                    <p className="mt-1 break-all text-sm text-zinc-700 sm:text-base">{link.url}</p>
                  )}
                </div>
                {isAdmin && (
                  <button type="button" onClick={() => void handleDeleteLink(link)} disabled={deletingId !== null} className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-xl border border-red-200 px-4 py-2.5 text-sm font-semibold text-red-700 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60">
                    {deletingId === link.id ? "Excluindo..." : "Excluir"}
                  </button>
                )}
              </article>
            ))}
          </section>
        )}
      </div>
    </main>
  );
}
