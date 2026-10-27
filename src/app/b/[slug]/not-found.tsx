export default function PublicBandNotFound() {
  return (
    <main className="flex min-w-0 flex-1 items-center justify-center px-4 py-16 sm:px-6">
      <section className="w-full max-w-md rounded-3xl border border-nav-border bg-surface p-8 text-center shadow-app-dashboard sm:p-10">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-accent">BandUp</p>
        <h1 className="mt-4 text-2xl font-semibold tracking-tight text-content">Página indisponível</h1>
        <p className="mt-3 text-sm leading-6 text-content-muted">Esta página não está disponível. Confira o endereço e tente novamente.</p>
      </section>
    </main>
  );
}
