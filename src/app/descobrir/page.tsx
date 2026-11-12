import Link from "next/link";
import BandDiscovery from "@/components/band-discovery";

export default function DiscoverBandsPage() {
  return <main className="workspace-theme min-w-0 flex-1 px-4 py-6 sm:px-6 sm:py-12">
    <div className="mx-auto w-full max-w-5xl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link href="/dashboard/bandas" className="inline-flex min-h-11 items-center rounded-xl px-3 text-sm font-semibold text-brand hover:bg-accent-soft focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-focus">← Minhas bandas</Link>
      </div>
      <header className="mt-8 sm:mt-12">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-accent">Sua música, novas conexões</p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight text-content sm:text-4xl">Encontre sua próxima banda</h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-content-muted">Um espaço para músicos e bandas se encontrarem. Pesquise bandas cadastradas pelo nome ou ID e solicite entrada. A participação depende de aprovação de um administrador.</p>
      </header>
      <BandDiscovery />
      <p className="mt-7 text-sm leading-6 text-content-muted">Já tem um projeto musical? <Link href="/bandas/nova" className="inline-flex min-h-11 items-center rounded px-1 font-semibold text-accent underline underline-offset-4 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-focus">Crie sua banda</Link></p>
    </div>
  </main>;
}
