"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

export default function Home() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let settled = false;
    // A stalled refresh must not leave the opening screen loading forever.
    // This is only a deadline: successful checks redirect immediately.
    const timeout = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      setError("A verificação demorou mais que o esperado. Tente novamente.");
    }, 15000);

    async function checkSession() {
      try {
        const { data, error: sessionError } =
          await getSupabaseBrowserClient().auth.getSession();

        if (settled) return;
        if (sessionError) throw sessionError;

        router.replace(data.session ? "/dashboard" : "/login");
        settled = true;
        window.clearTimeout(timeout);
      } catch {
        if (settled) return;
        settled = true;
        window.clearTimeout(timeout);
        setError("Não foi possível verificar sua sessão. Tente novamente.");
      }
    }

    void checkSession();

    return () => {
      settled = true;
      window.clearTimeout(timeout);
    };
  }, [router, attempt]);

  function retry() {
    setError("");
    setAttempt((previous) => previous + 1);
  }

  return (
    <main className="flex flex-1 items-center justify-center px-6 py-16">
      <div className="w-full max-w-sm text-center">
        <h1 className="text-4xl font-bold tracking-tight text-violet-800 sm:text-5xl">
          Band<span className="text-violet-500">Up</span>
        </h1>
        <p className="mt-4 text-base text-zinc-600">Sua banda, em sintonia.</p>
        {error ? (
          <div className="mt-8">
            <p role="alert" className="text-sm leading-6 text-red-700">{error}</p>
            <button
              type="button"
              onClick={retry}
              className="mt-5 rounded-xl bg-violet-700 px-5 py-3 text-sm font-semibold text-white transition hover:bg-violet-800 focus:outline-none focus:ring-4 focus:ring-violet-200"
            >
              Tentar novamente
            </button>
          </div>
        ) : (
          <p role="status" className="mt-8 flex items-center justify-center gap-2 text-sm text-zinc-500">
            <span
              aria-hidden="true"
              className="h-4 w-4 animate-spin rounded-full border-2 border-violet-200 border-t-violet-700 motion-reduce:animate-none"
            />
            Verificando sua sessão...
          </p>
        )}
      </div>
    </main>
  );
}
