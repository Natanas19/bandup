"use client";

import { Suspense, useEffect, useRef, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { installPullToRefresh, pullRefreshTouchEvents, usesServerRefresh, type PullRefreshDiagnostics } from "@/lib/pull-to-refresh";

function DebugFlag({ onChange }: { onChange: (enabled: boolean) => void }) {
  const enabled = useSearchParams()?.get("debugPullRefresh") === "1";
  useEffect(() => onChange(enabled), [enabled, onChange]);
  return null;
}

export default function PullToRefresh() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [refresh, setRefresh] = useState<"server" | "document" | null>(null);
  const [pull, setPull] = useState({ distance: 0, ready: false });
  const busy = useRef(false);
  const [debug, setDebug] = useState(false);
  const [diagnostics, setDiagnostics] = useState<PullRefreshDiagnostics | null>(null);

  useEffect(() => installPullToRefresh(document, window, {
    onDiagnostics: debug ? setDiagnostics : undefined,
    isRefreshing: () => busy.current,
    onPull: (distance, ready) => setPull({ distance, ready }),
    onRefresh: () => {
      busy.current = true;
      if (usesServerRefresh(window.location.pathname)) {
        setRefresh("server");
        startTransition(() => router.refresh());
      } else {
        // A document reload reruns browser-side queries that router.refresh preserves.
        setRefresh("document");
      }
    },
  }), [debug, router, startTransition]);

  useEffect(() => {
    if (!debug) {
      setDiagnostics(null);
      return;
    }
    const manifest = document.querySelector<HTMLLinkElement>('link[rel="manifest"]');
    const href = manifest?.getAttribute("href");
    if (!manifest || !href) return;
    manifest.setAttribute("href", "/pull-refresh-debug-manifest");
    return () => manifest.setAttribute("href", href);
  }, [debug]);

  useEffect(() => {
    if (refresh === "server" && !pending) {
      busy.current = false;
      setRefresh(null);
    }
    if (refresh !== "document") return;
    // Give the browser a frame to paint the indicator before navigation.
    let nextFrame = 0;
    const frame = requestAnimationFrame(() => {
      nextFrame = requestAnimationFrame(() => window.location.reload());
    });
    return () => {
      cancelAnimationFrame(frame);
      cancelAnimationFrame(nextFrame);
    };
  }, [refresh, pending]);

  return (
    <>
      <Suspense fallback={null}><DebugFlag onChange={setDebug} /></Suspense>
      {debug && diagnostics && (
        <aside aria-label="Diagnóstico de pull-to-refresh"
          className="pointer-events-none fixed right-2 top-[calc(env(safe-area-inset-top)+3rem)] z-50 max-w-[calc(100vw-1rem)] rounded-lg border border-nav-border bg-surface px-2 py-1.5 font-mono text-xs text-content shadow-app-card">
          <p className="font-semibold">Pull-to-refresh · diagnóstico</p>
          <p>Standalone: {diagnostics.standalone ? "sim" : "não"} · maxTouchPoints: {diagnostics.maxTouchPoints}</p>
          <p>CSS overscroll-behavior-y: {diagnostics.cssSupported ? "sim" : "não"}</p>
          <p>Listeners de atualização: {diagnostics.listenersInstalled ? "4 instalados" : "0 · só observação passiva"}</p>
          <ul>
            {pullRefreshTouchEvents.map(type => {
              const event = diagnostics.events[type];
              return <li key={type}>{type}: {event?.count ?? 0} · cancelable: {event ? String(event.cancelable) : "—"}</li>;
            })}
          </ul>
          <p>Estado: {diagnostics.reason}</p>
        </aside>
      )}
      <p role="status" className="sr-only">{refresh ? "Atualizando página…" : ""}</p>
      {(pull.distance > 0 || refresh) && (
        <div aria-hidden="true"
          className="pointer-events-none fixed left-1/2 top-[env(safe-area-inset-top)] z-50 w-max max-w-[90vw] -translate-x-1/2 rounded-full border border-nav-border bg-surface px-3 py-1.5 text-xs font-medium text-content shadow-app-card"
          style={{ top: `calc(env(safe-area-inset-top) + ${refresh ? 12 : pull.distance / 4}px)` }}>
          {refresh ? "Atualizando…" : pull.ready ? "Solte para atualizar" : "Puxe para atualizar"}
        </div>
      )}
    </>
  );
}
