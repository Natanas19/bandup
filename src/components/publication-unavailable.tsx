import { PUBLICATION_UNAVAILABLE_MESSAGE } from "@/lib/publication-control";

export default function PublicationUnavailable() {
  return (
    <section aria-labelledby="publication-unavailable-title" className="mx-auto my-8 w-full max-w-2xl rounded-3xl border border-nav-border bg-surface p-6 text-center shadow-app-card sm:p-10">
      <h1 id="publication-unavailable-title" className="text-2xl font-semibold text-content">Perfil público temporariamente indisponível</h1>
      <p role="status" className="mt-4 text-sm leading-6 text-content-muted">{PUBLICATION_UNAVAILABLE_MESSAGE}</p>
    </section>
  );
}
