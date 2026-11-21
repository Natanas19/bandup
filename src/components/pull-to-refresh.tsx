"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { installPullToRefresh, usesServerRefresh } from "@/lib/pull-to-refresh";

export default function PullToRefresh() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [refresh, setRefresh] = useState<"server" | "document" | null>(null);
  const [pull, setPull] = useState({ distance: 0, ready: false });
  const busy = useRef(false);

  useEffect(() => installPullToRefresh(document, window, {
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
  }), [router, startTransition]);

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
