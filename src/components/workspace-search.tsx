"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import BandSearch from "@/components/band-search";
import NavigationIcon from "@/components/navigation-icon";
import { SpaceSwitcherHeader } from "@/components/space-switcher";

const filters = ["Todos", "Bandas", "Músicos"] as const;

export default function WorkspaceSearch({ bandId, bandName, settingsHref, mobileNavigation, searchNavigation, children, contentClassName }: {
  bandId?: string;
  bandName?: string;
  settingsHref: string;
  mobileNavigation?: ReactNode;
  searchNavigation?: ReactNode;
  children: ReactNode;
  contentClassName: string;
}) {
  const pathname = usePathname();
  const [searchPath, setSearchPath] = useState<string | null>(null);
  const [filter, setFilter] = useState<(typeof filters)[number]>("Todos");
  const formId = useId();
  const summary = useRef<HTMLElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const previousScroll = useRef(0);
  const restore = useRef(false);
  const open = searchPath !== null && searchPath === pathname;
  const musicians = filter === "Músicos";

  useEffect(() => {
    if (searchPath !== null && !open) {
      if (input.current) input.current.value = "";
      setSearchPath(null);
    }
    if (open) {
      window.scrollTo({ top: 0, behavior: "instant" });
      input.current?.focus({ preventScroll: true });
    } else if (restore.current) {
      const field = input.current;
      if (field?.getClientRects().length) field.focus({ preventScroll: true });
      else summary.current?.focus({ preventScroll: true });
      restore.current = false;
      window.scrollTo({ top: previousScroll.current, behavior: "instant" });
    }
  }, [open, searchPath]);

  function startSearch() {
    if (open || restore.current) return;
    previousScroll.current = window.scrollY;
    setFilter("Todos");
    setSearchPath(pathname);
  }

  function cancelSearch() {
    if (input.current) input.current.value = "";
    restore.current = true;
    setSearchPath(null);
  }

  function cancelOnEscape(event: KeyboardEvent<HTMLElement>) {
    if (event.key !== "Escape" || event.defaultPrevented || !open) return;
    event.preventDefault();
    cancelSearch();
  }

  return <>
    <SpaceSwitcherHeader bandId={bandId} bandName={bandName} settingsHref={settingsHref}
      onSearch={startSearch} summaryRef={summary} searchActive={open} search={(
        <div role="search" aria-label="Busca global"
          className={`${open ? "flex" : "hidden md:flex"} min-h-14 w-full min-w-0 items-center gap-1.5 sm:gap-2 md:mr-auto md:w-auto md:min-w-40 md:max-w-md md:flex-1`}
          onKeyDown={cancelOnEscape}>
          <div className="flex min-w-0 flex-1 items-center rounded-control border border-outline bg-surface">
            <input ref={input} type="search" name="band-query" form={open && !musicians ? formId : undefined}
              aria-label="Pesquisar músicos ou bandas" placeholder="Encontre músicos ou bandas..."
              onFocus={startSearch} onChange={startSearch} onClick={startSearch}
              maxLength={100} autoComplete="off" enterKeyHint="search"
              className="min-h-11 w-0 flex-1 rounded-control bg-transparent px-2 text-base text-content placeholder:text-content-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus sm:px-3" />
            <button type={open ? "submit" : "button"} form={open && !musicians ? formId : undefined}
              onClick={open ? undefined : startSearch} disabled={open && musicians} aria-label="Buscar bandas"
              className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-control text-brand hover:bg-accent-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus disabled:opacity-50">
              <NavigationIcon name="Search" className="h-4 w-4" />
            </button>
          </div>
          {open && <button type="button" onClick={cancelSearch}
            className="min-h-11 shrink-0 rounded-control px-1 text-sm font-semibold text-brand hover:bg-accent-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus sm:px-2">
            Cancelar
          </button>}
        </div>
      )} />
    {mobileNavigation}
    {open && searchNavigation}
    <div className={contentClassName}>
      <div hidden={open} className={open ? undefined : "contents"}>{children}</div>
      {open && (
        <main className="mx-auto w-full min-w-0 max-w-3xl flex-1 space-y-4 px-4 py-5 sm:px-6"
          aria-label="Resultados da busca" onKeyDown={event => {
            if (event.key === "Escape" && window.matchMedia("(min-width: 768px)").matches
              && !(event.target instanceof Element && event.target.closest("dialog[open]"))) cancelOnEscape(event);
          }}>
          <div role="group" aria-label="Filtrar resultados" className="flex flex-wrap gap-2">
            {filters.map(option => <button key={option} type="button" aria-pressed={filter === option}
              onClick={() => setFilter(option)}
              className={`min-h-11 rounded-full border px-3 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus ${filter === option ? "border-accent-border bg-accent-soft text-brand" : "border-outline text-content-muted hover:bg-accent-soft"}`}>
              {option}
            </button>)}
          </div>
          <div hidden={musicians}><BandSearch headerFormId={formId} /></div>
          {musicians && <p role="status" className="rounded-xl border border-nav-border bg-surface p-4 text-sm text-content-muted">Busca de músicos em breve.</p>}
        </main>
      )}
    </div>
  </>;
}
