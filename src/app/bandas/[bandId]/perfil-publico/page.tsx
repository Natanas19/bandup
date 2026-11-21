"use client";

import { PUBLIC_IDENTITY_ENABLED } from "@/lib/publication-control";
import PublicationUnavailable from "@/components/publication-unavailable";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import BandNavigation from "@/components/band-navigation";
import { BandWorkspaceInfo } from "@/components/band-workspace";
import BandPublicLinks from "@/components/band-public-links";
import BandPublicProfileSettings from "@/components/band-public-profile-settings";
import BandPublicSections from "@/components/band-public-sections";
import BandSettings from "@/components/band-settings";
import NavigationIcon from "@/components/navigation-icon";
import PublicBandProfile from "@/components/public-band-profile";
import { toPublicBand, toPublicBandLinks } from "@/lib/public-band-data";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

type PageState = "loading" | "unauthenticated" | "unavailable" | "error" | "ready";
type Band = { name: string; slug: string | null; is_public: boolean; role: string; description: string | null; logo_url: string | null };

export default function BandProfilePage() {
  const { bandId } = useParams<{ bandId: string }>();
  if (PUBLIC_IDENTITY_ENABLED) return <EnabledBandProfilePage key={bandId} />;
  return <BandSettings bandId={bandId} activeSection="perfil-publico">
    <PublicationUnavailable />
  </BandSettings>;
}

function EnabledBandProfilePage() {
  const { bandId } = useParams<{ bandId: string }>();
  const [pageState, setPageState] = useState<PageState>("loading");
  const [band, setBand] = useState<Band | null>(null);
  const [previewOpen, setPreviewOpen] = useState(true);

  useEffect(() => {
    let isMounted = true;
    async function loadProfile() {
      setPageState("loading");
      setBand(null);
      try {
        const supabase = getSupabaseBrowserClient();
        const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
        if (!isMounted) return;
        if (sessionError) { setPageState("error"); return; }
        const user = sessionData.session?.user;
        if (!user) { setPageState("unauthenticated"); return; }
        const { data: membership, error: membershipError } = await supabase.from("band_members")
          .select("role").eq("band_id", bandId).eq("user_id", user.id).maybeSingle();
        if (!isMounted) return;
        if (membershipError) { setPageState("error"); return; }
        if (!membership) { setPageState("unavailable"); return; }
        const { data, error } = await supabase.from("bands")
          .select("name, slug, is_public, description, logo_url").eq("id", bandId).maybeSingle();
        if (!isMounted) return;
        if (error) { setPageState("error"); return; }
        if (!data) { setPageState("unavailable"); return; }
        setBand({ ...data, role: membership.role });
        setPageState("ready");
      } catch {
        if (isMounted) setPageState("error");
      }
    }
    void loadProfile();
    return () => { isMounted = false; };
  }, [bandId]);

  if (pageState !== "ready" || !band) {
    return (
      <main className="flex flex-1 justify-center px-4 py-8 sm:px-6 sm:py-12">
        <section className="w-full max-w-2xl">
          <Link href={`/bandas/${bandId}`} className="inline-flex min-h-11 items-center rounded-xl border border-accent-border px-4 py-2.5 text-sm font-semibold text-brand transition hover:bg-accent-soft focus:outline-none focus:ring-4 focus:ring-input-ring">
            ← Voltar para a visão geral
          </Link>
          <div className="mt-6 rounded-3xl border border-nav-border bg-surface p-8 text-center shadow-app-dashboard sm:p-10">
            {pageState === "loading" ? (
              <p className="text-content-muted">Carregando perfil público...</p>
            ) : pageState === "unauthenticated" ? (
              <>
                <h1 className="text-2xl font-semibold text-content">Entre para continuar</h1>
                <p className="mt-3 text-sm text-content-muted">Faça login para acessar o perfil público da banda.</p>
                <Link href="/login" className="mt-6 inline-flex min-h-11 items-center rounded-xl bg-primary px-5 py-3 text-sm font-semibold text-on-primary transition hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-focus">Ir para o login</Link>
              </>
            ) : pageState === "unavailable" ? (
              <>
                <h1 className="text-2xl font-semibold text-content">Banda não encontrada</h1>
                <p className="mt-3 text-sm text-content-muted">Essa banda não existe ou você não tem acesso a ela.</p>
              </>
            ) : (
              <p role="alert" className="text-sm text-danger">Não foi possível carregar o perfil público agora. Tente novamente.</p>
            )}
          </div>
        </section>
      </main>
    );
  }

  const isAdmin = band.role === "admin";
  const previewSlug = band.slug ?? "";
  const profile = band.name.trim()
    ? toPublicBand({ name: band.name, slug: previewSlug, description: band.description ?? null, logo_url: band.logo_url ?? null },
      previewSlug, process.env.NEXT_PUBLIC_SUPABASE_URL ?? "")
    : null;

  return (
    <main className="flex min-w-0 flex-1 justify-center px-4 pb-6 pt-5 sm:px-6 sm:pb-10 sm:pt-8 md:pt-10">
      <div className="w-full min-w-0 max-w-5xl">
        <BandWorkspaceInfo name={band.name} role={band.role} />
        <div className="md:hidden"><BandNavigation bandId={bandId} activeSection="perfil-publico" /></div>
        <BandPublicLinks bandId={bandId} isAdmin={isAdmin} renderEditor={(links, manager) => (
          <>
            <BandPublicProfileSettings key={bandId} bandId={bandId} initialSlug={band.slug}
              initiallyPublic={band.is_public} isAdmin={isAdmin} renderPreview={publicPath => (
                <details className="group mt-2 border-b border-nav-border" open={previewOpen}
                  onToggle={event => setPreviewOpen(event.currentTarget.open)}>
                  <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 rounded-lg px-2 py-2 text-sm font-semibold text-content hover:bg-accent-soft focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-focus [&::-webkit-details-marker]:hidden">
                    Prévia da página pública
                    <span aria-hidden="true" className="mr-1 h-2.5 w-2.5 shrink-0 rotate-45 border-b-2 border-r-2 border-brand transition-transform group-open:rotate-[225deg] motion-reduce:transition-none" />
                  </summary>
                  {previewOpen && profile && (
                    <div className="relative isolate rounded-xl border-t border-nav-border bg-surface focus-within:ring-2 focus-within:ring-focus">
                      {publicPath && <a href={publicPath} target="_blank" rel="noopener noreferrer"
                        aria-label="Abrir prévia do perfil público (abre em nova aba)"
                        className="absolute inset-0 rounded-xl focus-visible:outline-none" />}
                      {/* Let the preview's own links receive clicks above the background link. */}
                      <div className={publicPath ? "pointer-events-none relative z-10 overflow-hidden rounded-xl [&_a]:pointer-events-auto" : "overflow-hidden rounded-xl"}>
                        {publicPath && <span className="absolute right-3 top-3 z-10 rounded-lg bg-surface p-1.5 text-brand">
                          <NavigationIcon name="ArrowUpRight" className="h-4 w-4" />
                        </span>}
                        <PublicBandProfile band={profile} preview
                          links={toPublicBandLinks(links?.map(link => ({ ...link, slug: previewSlug })), previewSlug)} />
                      </div>
                    </div>
                  )}
                  {previewOpen && !profile && <p className="px-2 pb-3 text-sm text-content-muted">A prévia está indisponível.</p>}
                </details>
              )} />
            <BandPublicSections bandId={bandId} isAdmin={isAdmin} linksManager={manager} />
          </>
        )} />
      </div>
    </main>
  );
}
