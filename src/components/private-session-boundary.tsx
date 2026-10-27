"use client";

import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { getSupabaseAuthStorageKey, getSupabaseBrowserClient } from "@/lib/supabase/client";
import { createPrivateSessionController, getPrivateScope, type PrivateSessionSnapshot } from "@/lib/private-session";

function PrivateSessionScope({ scope, children }: { scope: string; children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const lastPath = useRef(pathname);
  const controller = useRef<ReturnType<typeof createPrivateSessionController> | null>(null);
  const [snapshot, setSnapshot] = useState<PrivateSessionSnapshot>({ phase: "checking", epoch: 0 });
  useEffect(() => {
    try {
      const active = createPrivateSessionController(getSupabaseBrowserClient(), window, document,
        getSupabaseAuthStorageKey(), scope.startsWith("band:") ? scope.slice(5) : undefined);
      controller.current = active;
      const unsubscribe = active.subscribe(setSnapshot);
      setSnapshot(active.getSnapshot());
      void active.check();
      return () => { unsubscribe(); active.dispose(); controller.current = null; };
    } catch { setSnapshot({ phase: "error", epoch: 0 }); }
  }, [scope]);
  useEffect(() => {
    if (lastPath.current !== pathname) { lastPath.current = pathname; void controller.current?.check(); }
  }, [pathname]);
  useEffect(() => {
    if (snapshot.phase === "signed-out") router.replace("/login");
    else if (snapshot.phase === "forbidden") router.replace("/dashboard");
  }, [snapshot.phase, router]);

  if (snapshot.phase === "ready") return <Fragment key={snapshot.epoch}>{children}</Fragment>;
  return <main className="flex flex-1 items-center justify-center px-4 py-10">
    <div className="text-center text-content-muted" role={snapshot.phase === "error" ? "alert" : "status"}>
      <p>{snapshot.phase === "error" ? "N?o foi poss?vel verificar seu acesso. Tente novamente." : "Verificando seu acesso..."}</p>
      {snapshot.phase === "error" && <button type="button" onClick={() => { void controller.current?.check(true); }}
        className="mt-4 rounded-xl bg-primary px-5 py-3 font-semibold text-on-primary hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-focus">Tentar novamente</button>}
    </div>
  </main>;
}

export default function PrivateSessionBoundary({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const scope = getPrivateScope(pathname);
  return scope ? <PrivateSessionScope key={scope} scope={scope}>{children}</PrivateSessionScope> : children;
}
