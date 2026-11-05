import BandEntryPanel from "@/components/band-entry-panel";

export default function LoadingDiscovery() {
  return <main className="min-w-0 flex-1 px-4 py-8 sm:px-6"><div className="mx-auto max-w-5xl">
    <h1 className="text-3xl font-semibold text-content">Descobrir bandas</h1>
    <BandEntryPanel state="loading" />
  </div></main>;
}
