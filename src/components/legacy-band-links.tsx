"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import BandNavigation from "@/components/band-navigation";
import { BandWorkspaceInfo } from "@/components/band-workspace";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { readLegacyBandLinks, type LegacyBandLinksResult } from "@/lib/legacy-band-data";
import { LINK_WRITES_UNAVAILABLE_MESSAGE } from "@/lib/publication-control";
import { getSafeExternalUrl } from "@/lib/social-links";

type State = "loading" | "signed-out" | "unavailable" | "error" | "ready";

export default function LegacyBandLinks() {
  const { bandId } = useParams<{ bandId: string }>();
  const [state, setState] = useState<State>("loading");
  const [result, setResult] = useState<Extract<LegacyBandLinksResult, { status: "ready" }> | null>(null);
  useEffect(() => {
    let active = true;
    setState("loading"); setResult(null);
    async function load() {
      try {
        const client = getSupabaseBrowserClient();
        const { data, error } = await client.auth.getUser();
        if (!active) return;
        if (error) { setState("error"); return; }
        if (!data.user) { setState("signed-out"); return; }
        const loaded = await readLegacyBandLinks(client, bandId, data.user.id);
        if (!active) return;
        if (loaded.status !== "ready") { setState("unavailable"); return; }
        setResult(loaded); setState("ready");
      } catch { if (active) setState("error"); }
    }
    void load();
    return () => { active = false; };
  }, [bandId]);

  return (
    <main className="flex flex-1 justify-center px-4 py-6 sm:px-6 sm:py-10">
      <div className="w-full min-w-0 max-w-5xl">
        {result && <BandWorkspaceInfo name={result.bandName} role={result.role} />}
        <div className="md:hidden"><BandNavigation bandId={bandId} activeSection="links" /></div>
        <header className="mt-7">
          <h1 className="text-3xl font-semibold tracking-tight text-content sm:text-4xl">Links da banda</h1>
          <p role="status" className="mt-4 rounded-2xl border border-nav-border bg-surface p-5 text-sm leading-6 text-content-muted">{LINK_WRITES_UNAVAILABLE_MESSAGE}</p>
        </header>
        {state === "loading" && <p className="mt-6 text-content-muted">Carregando links...</p>}
        {state === "signed-out" && <Link href="/login" className="mt-6 inline-flex min-h-11 items-center text-brand">Entre para acessar os links da banda</Link>}
        {state === "unavailable" && <p className="mt-6 text-content-muted">Banda não encontrada ou sem acesso.</p>}
        {state === "error" && <p role="alert" className="mt-6 text-danger">Não foi possível carregar os links. Tente novamente.</p>}
        {state === "ready" && result && <ul className="mt-6 space-y-3">
          {result.links.length === 0 && <li className="rounded-2xl border border-nav-border bg-surface p-6 text-content-muted">Nenhum link cadastrado.</li>}
          {result.links.map(link => {
            const href = getSafeExternalUrl(link.url);
            return <li key={link.id} className="min-w-0 rounded-2xl border border-nav-border bg-surface p-5 shadow-app-card">
              <p className="text-sm font-semibold text-content">{link.platform}</p>
              {href ? <a href={href} target="_blank" rel="noopener noreferrer" className="mt-2 inline-flex min-h-11 max-w-full items-center break-all text-sm text-brand focus-visible:outline focus-visible:outline-2">{href}</a>
                : <p className="mt-2 text-sm text-content-muted">Endereço indisponível por segurança.</p>}
            </li>;
          })}
        </ul>}
      </div>
    </main>
  );
}
