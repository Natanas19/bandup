export default function PublicBandLoading() {
  return (
    <main className="flex flex-1 items-center justify-center px-4 py-16">
      <p role="status" aria-live="polite" className="text-sm text-accent">
        Carregando página…
      </p>
    </main>
  );
}
