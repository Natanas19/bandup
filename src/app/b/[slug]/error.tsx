"use client";

export default function PublicBandError({ reset }: { reset: () => void }) {
  return (
    <main className="flex flex-1 items-center justify-center px-4 py-16">
      <section className="w-full max-w-md rounded-3xl border border-violet-100 bg-white p-8 text-center">
        <h1 className="text-2xl font-semibold text-zinc-900">Página temporariamente indisponível</h1>
        <p role="alert" className="mt-3 text-sm leading-6 text-zinc-600">
          Não foi possível carregar esta página. Tente novamente em instantes.
        </p>
        <button
          type="button"
          onClick={reset}
          className="mt-6 min-h-[44px] rounded-xl bg-violet-700 px-5 py-3 font-semibold text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-violet-700"
        >
          Tentar novamente
        </button>
      </section>
    </main>
  );
}
