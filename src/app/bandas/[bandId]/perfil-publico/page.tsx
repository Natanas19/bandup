"use client";

import { PUBLIC_IDENTITY_ENABLED } from "@/lib/publication-control";
import PublicationUnavailable from "@/components/publication-unavailable";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import BandNavigation from "@/components/band-navigation";
import { BandWorkspaceInfo } from "@/components/band-workspace";
import BandPublicProfileSettings from "@/components/band-public-profile-settings";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import ThemeSelector from "@/components/theme-selector";
import BandDeletionPanel from "@/components/band-deletion-panel";

type PageState = "loading" | "unauthenticated" | "unavailable" | "error" | "ready";
type Band = { name: string; slug: string | null; is_public: boolean; role: string };

export default function BandProfilePage() {
  const { bandId } = useParams<{ bandId: string }>();
  if (PUBLIC_IDENTITY_ENABLED) return <EnabledBandProfilePage />;
  return <><main className="flex flex-1 justify-center px-4 py-6 sm:px-6 sm:py-10"><div className="w-full min-w-0 max-w-5xl">
    <div className="md:hidden"><BandNavigation bandId={bandId} activeSection="perfil-publico" /></div>
    <section aria-labelledby="band-appearance-title" className="mt-6 rounded-2xl border border-nav-border bg-surface p-5 sm:p-6">
      <h1 id="band-appearance-title" className="text-lg font-semibold text-content">Aparência</h1>
      <ThemeSelector className="mt-4" />
    </section>
    <PublicationUnavailable />
  </div></main><BandDeletionPanel key={bandId} bandId={bandId} /></>;
}

function EnabledBandProfilePage() {
  const { bandId } = useParams<{ bandId: string }>();
  const [pageState, setPageState] = useState<PageState>("loading");
  const [band, setBand] = useState<Band | null>(null);

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
          .select("name, slug, is_public").eq("id", bandId).maybeSingle();
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
      <><main className="flex flex-1 justify-center px-4 py-8 sm:px-6 sm:py-12">
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
      </main><BandDeletionPanel key={bandId} bandId={bandId} /></>
    );
  }

  return (
    <><main className="flex min-w-0 flex-1 justify-center px-4 py-6 sm:px-6 sm:py-10">
      <div className="w-full min-w-0 max-w-5xl">
        <BandWorkspaceInfo name={band.name} role={band.role} />
        <div className="md:hidden"><BandNavigation bandId={bandId} activeSection="perfil-publico" /></div>
        <header className="mt-7">
          <p className="break-words text-xs font-semibold tracking-[0.16em] text-accent uppercase">{band.name}</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-content sm:text-4xl">Perfil Público</h1>
          <p className="mt-2 text-sm leading-6 text-content-muted">Gerencie a visibilidade e o endereço público da banda.</p>
        </header>
        <section aria-labelledby="band-appearance-title" className="mt-6 rounded-2xl border border-nav-border bg-surface p-5 sm:p-6">
          <h2 id="band-appearance-title" className="text-lg font-semibold text-content">Aparência</h2>
          <ThemeSelector className="mt-4" />
        </section>
        <BandPublicProfileSettings key={bandId} bandId={bandId} initialSlug={band.slug}
          initiallyPublic={band.is_public} isAdmin={band.role === "admin"} />
      </div>
    </main><BandDeletionPanel key={bandId} bandId={bandId} /></>
  );
}
