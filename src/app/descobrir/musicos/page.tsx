import Link from "next/link";
import { notFound } from "next/navigation";
import MusicianDiscovery from "@/components/musician-discovery";
import { MusicianInvitationDiscovery } from "@/components/band-invitations";
import { BAND_INVITATIONS_ENABLED } from "@/lib/band-invitations";
import { MUSICIAN_DISCOVERY_ENABLED } from "@/lib/musician-discovery";

export default function DiscoverMusiciansPage() {
  if (!MUSICIAN_DISCOVERY_ENABLED) notFound();
  return <main className="workspace-theme min-w-0 flex-1 px-4 py-6 sm:px-6 sm:py-12">
    <div className="mx-auto w-full max-w-5xl">
      <Link href="/descobrir" className="inline-flex min-h-11 items-center rounded-xl px-3 text-sm font-semibold text-brand hover:bg-accent-soft focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-focus">← Descobrir bandas</Link>
      <header className="mt-8 sm:mt-12">
        <p className="text-xs font-semibold uppercase tracking-widest text-accent">Sua música, novas conexões</p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight text-content sm:text-4xl">Descobrir músicos</h1>
        <p className="mt-3 text-sm leading-6 text-content-muted">Explore os músicos cadastrados e veja quem está disponível para bandas.</p>
      </header>
      {BAND_INVITATIONS_ENABLED ? <MusicianInvitationDiscovery /> : <MusicianDiscovery />}
    </div>
  </main>;
}
