"use client";

import Link from "next/link";
import BandEntryPanel from "@/components/band-entry-panel";

export default function DiscoveryError({ reset }: { reset: () => void }) {
  return <main className="min-w-0 flex-1 px-4 py-8 sm:px-6"><div className="mx-auto max-w-5xl">
    <h1 className="text-3xl font-semibold text-content">Descobrir bandas</h1>
    <BandEntryPanel state="error" />
    <div className="mt-6 flex flex-wrap gap-3">
      <button type="button" onClick={reset} className="min-h-11 rounded-xl bg-primary px-5 py-3 text-sm font-semibold text-on-primary hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-focus">Tentar novamente</button>
      <Link href="/dashboard/bandas" className="inline-flex min-h-11 items-center rounded-xl px-5 py-3 text-sm font-semibold text-brand focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-focus">Voltar para minhas bandas</Link>
    </div>
  </div></main>;
}
