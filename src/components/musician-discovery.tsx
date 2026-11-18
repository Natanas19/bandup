"use client";

import { useEffect, useRef, useState } from "react";
import ProfileAvatar from "@/components/profile-avatar";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { discoverMusicians, MUSICIAN_PAGE_SIZE, type DiscoveredMusician } from "@/lib/musician-discovery";

const button = "min-h-11 rounded-xl border border-accent-border px-4 py-3 text-sm font-semibold text-brand hover:bg-accent-soft focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-focus disabled:opacity-50";

export default function MusicianDiscovery() {
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState({ query: "", offset: 0, revision: 0 });
  const [musicians, setMusicians] = useState<DiscoveredMusician[]>([]);
  const [hasNext, setHasNext] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const generation = useRef(0);
  const request = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!search.query) return;
    const controller = new AbortController();
    request.current = controller;
    const ticket = ++generation.current;
    setLoading(true); setError(false); setMusicians([]); setHasNext(false);
    void discoverMusicians(getSupabaseBrowserClient(), search.query, search.offset, controller.signal)
      .then(result => {
        if (!controller.signal.aborted && ticket === generation.current) {
          setMusicians(result.musicians); setHasNext(result.hasNext);
        }
      }).catch(() => {
        if (!controller.signal.aborted && ticket === generation.current) setError(true);
      }).finally(() => {
        if (!controller.signal.aborted && ticket === generation.current) setLoading(false);
      });
    return () => { controller.abort(); };
  }, [search]);

  function navigate(nextQuery: string, offset: number) {
    if (!nextQuery) return;
    generation.current++; request.current?.abort();
    setLoading(true); setError(false); setMusicians([]); setHasNext(false);
    setSearch(previous => ({ query: nextQuery, offset, revision: previous.revision + 1 }));
  }

  return <section className="mt-7 space-y-5 rounded-2xl border border-nav-border bg-surface p-4 sm:p-6" aria-label="Busca de músicos">
    <form onSubmit={event => { event.preventDefault(); navigate(query.trim(), 0); }} className="space-y-3">
      <label htmlFor="musician-query" className="block text-sm font-semibold text-content">Buscar por nome</label>
      <div className="flex flex-col gap-3 sm:flex-row">
        <input id="musician-query" type="search" maxLength={100} autoComplete="off" value={query}
          onChange={event => setQuery(event.target.value)}
          className="min-h-11 min-w-0 flex-1 rounded-xl border border-outline bg-surface px-4 py-3 text-base text-content focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-focus" />
        <button type="submit" className={button} disabled={!query.trim()}>Buscar músicos</button>
      </div>
    </form>
    <div aria-busy={loading}>
      <p role="status" className="text-sm text-content-muted">{!search.query ? "Digite um nome para buscar músicos." : loading ? "Carregando músicos..." : error ? "" : musicians.length ? `Página ${search.offset / MUSICIAN_PAGE_SIZE + 1} · ${musicians.length} músicos` : "Nenhum músico encontrado."}</p>
      {error && <div className="space-y-3"><p role="alert" className="text-sm text-danger">Não foi possível carregar os músicos. Tente novamente.</p><button className={button} onClick={() => navigate(search.query, search.offset)}>Tentar novamente</button></div>}
      <ul className="mt-4 grid gap-3 sm:grid-cols-2">
        {musicians.map((musician, index) => <li key={`${search.offset}-${index}`} className="flex min-w-0 items-center gap-3 rounded-xl border border-nav-border p-4">
          <ProfileAvatar name={musician.name} imageUrl={musician.avatarUrl} />
          <div className="min-w-0"><h2 className="break-words font-semibold text-content [overflow-wrap:anywhere]">{musician.name}</h2>
            <p className={`mt-1 text-sm ${musician.available ? "text-brand" : "text-content-muted"}`}>{musician.available ? "Disponível para bandas" : "Indisponível para bandas"}</p>
          </div>
        </li>)}
      </ul>
    </div>
    {search.query && <nav aria-label="Paginação de músicos" className="flex flex-wrap gap-3">
      <button className={button} disabled={loading || search.offset === 0} onClick={() => navigate(search.query, Math.max(0, search.offset - MUSICIAN_PAGE_SIZE))}>Anterior</button>
      <button className={button} disabled={loading || error || !hasNext} onClick={() => navigate(search.query, search.offset + MUSICIAN_PAGE_SIZE)}>Próxima</button>
    </nav>}
  </section>;
}
