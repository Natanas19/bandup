"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { normalizeDisplayName } from "@/lib/display-name";
import { isLaboratoryHttpOrigin } from "@/lib/development-lab";
import { safeBandLogo } from "@/lib/public-band-data";
import ProfileAvatar from "@/components/profile-avatar";
import NavigationIcon from "@/components/navigation-icon";
import { WorkspaceSettingsMenu } from "@/components/workspace-settings";

type SpaceMembership = { band_id: string; band: { id: string; name: string; logo_url: string | null } | null };
type PersonalProfile = { name: string; imageUrl: string | null };
const supabaseOrigin = typeof process !== "undefined" ? process.env.NEXT_PUBLIC_SUPABASE_URL : undefined;

function safePersonalAvatar(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const image = new URL(value);
    const protocolIsSafe = image.protocol === "https:" || isLaboratoryHttpOrigin(image.origin, "public");
    return protocolIsSafe && !image.username && !image.password ? image.href : null;
  } catch { return null; }
}

export default function SpaceSwitcher({ bandId, bandName }: { bandId?: string; bandName?: string }) {
  const [bands, setBands] = useState<SpaceMembership[]>([]);
  const [personal, setPersonal] = useState<PersonalProfile>({ name: "Meu Espaço", imageUrl: null });
  const [loadFailed, setLoadFailed] = useState(false);
  const selector = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const client = getSupabaseBrowserClient();
        const { data: account, error: authError } = await client.auth.getUser();
        if (authError || !account.user) throw new Error("Account unavailable");
        const metadata = account.user.user_metadata ?? {};
        const profileName = normalizeDisplayName(metadata.display_name)
          ?? normalizeDisplayName(metadata.full_name)
          ?? normalizeDisplayName(metadata.name)
          ?? "Meu Espaço";
        if (active) setPersonal({
          name: profileName,
          imageUrl: safePersonalAvatar(metadata.avatar_url ?? metadata.picture),
        });
        const { data, error } = await client.from("band_members")
          .select("band_id, band:bands!inner(id, name, logo_url)")
          .eq("user_id", account.user.id).order("band_id", { ascending: true });
        if (error) throw error;
        if (active) setBands((data ?? []) as unknown as SpaceMembership[]);
      } catch {
        if (active) setLoadFailed(true);
      }
    })();
    return () => { active = false; };
  }, []);

  const availableBands = bands.filter(item => item.band?.id === item.band_id && !!item.band.name.trim());
  const selectedBand = bandId ? availableBands.find(item => item.band_id === bandId)?.band : null;
  const selectedName = bandId ? selectedBand?.name ?? bandName ?? "Espaço da banda" : personal.name;
  const selectedImage = bandId
    ? safeBandLogo(selectedBand?.logo_url ?? null, supabaseOrigin ?? "https://invalid.local")
    : personal.imageUrl;
  const bandImage = (band: SpaceMembership["band"]) => safeBandLogo(
    band?.logo_url ?? null,
    supabaseOrigin ?? "https://invalid.local",
  );

  return <section aria-label="Alternar espaço" className="w-full min-w-0 sm:w-auto sm:min-w-72">
    <details ref={selector} className="group relative">
      <summary aria-label={`Perfis. Perfil selecionado: ${selectedName}. Abrir seletor`} className="flex min-h-14 w-full cursor-pointer list-none items-center gap-3 rounded-panel border border-outline bg-surface px-3 py-2.5 text-left shadow-app-card transition hover:border-accent-border focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-focus [&::-webkit-details-marker]:hidden">
        <ProfileAvatar name={selectedName} imageUrl={selectedImage} />
        <span className="min-w-0 flex-1">
          <span className="block text-[0.62rem] font-bold uppercase tracking-[0.17em] text-content-muted">Meus perfis</span>
          <span className="mt-0.5 block truncate text-sm font-semibold text-content">{selectedName}</span>
        </span>
        <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" className="h-4 w-4 shrink-0 text-content-muted transition-transform group-open:rotate-180">
          <path d="m5 7.5 5 5 5-5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </summary>
      <div className="absolute left-0 right-0 top-full z-40 mt-2 flex max-h-[min(32rem,calc(100dvh-6rem))] flex-col overflow-hidden rounded-panel border border-outline bg-surface p-2 shadow-app-panel sm:left-auto sm:w-80">
        <section aria-labelledby="personal-profile-section" className="shrink-0">
          <h2 id="personal-profile-section" className="px-2 py-2 text-[0.65rem] font-semibold uppercase tracking-[0.15em] text-content-muted">Meu perfil</h2>
          <ul>
          <li><Link href="/dashboard" onClick={() => { if (selector.current) selector.current.open = false; }} aria-current={!bandId ? "page" : undefined} className={`flex min-h-12 items-center gap-3 rounded-control px-3 py-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus ${!bandId ? "bg-accent-soft" : "hover:bg-accent-soft"}`}>
            <ProfileAvatar name={personal.name} imageUrl={personal.imageUrl} />
            <span className="min-w-0 flex-1 truncate text-sm font-semibold text-content">{personal.name}</span>
            {!bandId && <span className="text-xs font-semibold text-accent">Atual</span>}
          </Link></li>
          </ul>
        </section>
        <section aria-labelledby="band-profiles-section" className="mt-2 flex min-h-0 flex-initial flex-col">
          <h2 id="band-profiles-section" className="shrink-0 px-2 py-2 text-[0.65rem] font-semibold uppercase tracking-[0.15em] text-content-muted">Minhas bandas</h2>
          <ul aria-labelledby="band-profiles-section" className="min-h-0 max-h-64 flex-initial space-y-1 overflow-y-auto overscroll-contain">
          {availableBands.map(({ band_id, band }) => {
            const active = bandId === band_id;
            return <li key={band_id}><Link href={`/bandas/${encodeURIComponent(band_id)}`} onClick={() => { if (selector.current) selector.current.open = false; }} aria-current={active ? "page" : undefined}
              className={`flex min-h-12 items-center gap-3 rounded-control px-3 py-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus ${active ? "bg-accent-soft" : "hover:bg-accent-soft"}`}>
              <ProfileAvatar name={band!.name} imageUrl={bandImage(band)} />
              <span className="min-w-0 flex-1 truncate text-sm font-semibold text-content">{band!.name}</span>
              {active && <span className="text-xs font-semibold text-accent">Atual</span>}
            </Link></li>;
          })}
          </ul>
        </section>
        {loadFailed && <p role="status" className="mt-2 shrink-0 px-3 py-2 text-xs text-content-subtle">Não foi possível carregar todos os perfis.</p>}
        <div className="mt-2 grid shrink-0 gap-2 border-t border-outline-subtle px-1 pt-2">
          <Link href="/bandas/nova" onClick={() => { if (selector.current) selector.current.open = false; }} className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-control bg-primary px-3 py-2.5 text-center text-sm font-semibold text-on-primary hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-focus"><NavigationIcon name="Plus" className="h-4 w-4" />Criar banda</Link>
          <Link href="/descobrir" onClick={() => { if (selector.current) selector.current.open = false; }} className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-control border border-accent-border px-3 py-2.5 text-center text-sm font-semibold text-brand hover:bg-accent-soft focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-focus"><NavigationIcon name="Search" className="h-4 w-4" />Procurar banda</Link>
        </div>
      </div>
    </details>
  </section>;
}

export function SpaceSwitcherHeader({ bandId, bandName, settingsHref }: { bandId?: string; bandName?: string; settingsHref: string }) {
  return <header className="sticky top-0 z-30 border-b border-outline-subtle bg-surface/95 px-4 py-2.5 backdrop-blur sm:px-6 md:px-8 lg:px-10">
    <div className="mx-auto flex w-full max-w-7xl items-center justify-between gap-3">
      <div className="min-w-0 flex-1 md:flex md:justify-end">
        <div className="w-full min-w-0 sm:w-auto"><SpaceSwitcher bandId={bandId} bandName={bandName} /></div>
      </div>
      <div className="shrink-0 md:hidden"><WorkspaceSettingsMenu href={settingsHref} showBandFeatures={!!bandId} /></div>
    </div>
  </header>;
}
