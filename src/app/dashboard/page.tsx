"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { User } from "@supabase/supabase-js";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

export default function DashboardPage() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [logoutError, setLogoutError] = useState("");

  async function handleSignOut() {
    setIsLoggingOut(true);
    setLogoutError("");

    try {
      const { error } = await getSupabaseBrowserClient().auth.signOut();
      if (error) {
        setLogoutError("Não foi possível sair agora. Tente novamente.");
        return;
      }

      router.replace("/login");
    } catch {
      setLogoutError("Não foi possível sair agora. Tente novamente.");
    } finally {
      setIsLoggingOut(false);
    }
  }

  useEffect(() => {
    let isMounted = true;

    async function loadUser() {
      try {
        const { data, error } = await getSupabaseBrowserClient().auth.getUser();
        if (isMounted && !error) setUser(data.user);
      } finally {
        if (isMounted) setIsLoading(false);
      }
    }

    void loadUser();
    return () => {
      isMounted = false;
    };
  }, []);

  return (
    <main className="flex flex-1 items-center justify-center px-6 py-16">
      <section className="w-full max-w-xl rounded-3xl border border-violet-100 bg-white p-8 text-center shadow-[0_20px_60px_-32px_rgba(54,36,104,0.28)] sm:p-12">
        <p className="text-sm font-semibold tracking-widest text-violet-700 uppercase">BandUp</p>
        <h1 className="mt-4 text-4xl font-semibold tracking-tight text-zinc-900">Dashboard</h1>
        {isLoading ? (
          <p className="mt-4 text-zinc-600">Verificando sua sessão...</p>
        ) : user ? (
          <div className="mt-5">
            <p className="text-zinc-600">Você está autenticado e já pode acessar seu espaço.</p>
            <p className="mt-2 text-sm text-zinc-500">{user.email}</p>
            {logoutError && (
              <p role="alert" className="mt-4 text-sm text-red-700">
                {logoutError}
              </p>
            )}
            <button
              type="button"
              onClick={handleSignOut}
              disabled={isLoggingOut}
              className="mt-6 inline-flex rounded-xl bg-violet-700 px-5 py-3 text-sm font-semibold text-white transition hover:bg-violet-800 disabled:cursor-not-allowed disabled:opacity-70"
            >
              {isLoggingOut ? "Saindo..." : "Sair"}
            </button>
          </div>
        ) : (
          <div className="mt-5">
            <p className="text-zinc-600">Nenhuma sessão autenticada foi encontrada.</p>
            <Link href="/login" className="mt-5 inline-flex rounded-xl bg-violet-700 px-5 py-3 text-sm font-semibold text-white transition hover:bg-violet-800">
              Ir para o login
            </Link>
          </div>
        )}
      </section>
    </main>
  );
}
