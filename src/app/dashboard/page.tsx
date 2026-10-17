"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { User } from "@supabase/supabase-js";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

type BandMembership = {
  role: string;
  band: {
    id: string;
    name: string;
    description: string | null;
  } | null;
};

export default function DashboardPage() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [bands, setBands] = useState<BandMembership[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [logoutError, setLogoutError] = useState("");
  const [loadError, setLoadError] = useState("");

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

    async function loadDashboard() {
      try {
        const supabase = getSupabaseBrowserClient();
        const { data: sessionData, error: sessionError } = await supabase.auth.getSession();

        if (!isMounted) return;
        if (sessionError) {
          setLoadError("Não foi possível carregar sua conta agora. Tente novamente.");
          return;
        }

        const session = sessionData.session;
        if (!session) {
          setUser(null);
          return;
        }

        setUser(session.user);

        const { data, error } = await supabase
          .from("band_members")
          .select("role, band:bands!inner(id, name, description)")
          .eq("user_id", session.user.id);

        if (!isMounted) return;
        if (error) {
          setLoadError("Não foi possível carregar suas bandas agora. Tente novamente.");
          return;
        }

        setBands((data ?? []) as unknown as BandMembership[]);
      } catch {
        if (isMounted) {
          setLoadError("Não foi possível carregar sua conta agora. Tente novamente.");
        }
      } finally {
        if (isMounted) setIsLoading(false);
      }
    }

    void loadDashboard();
    return () => {
      isMounted = false;
    };
  }, []);

  return (
    <main className="flex flex-1 items-center justify-center px-4 py-6 sm:px-6 sm:py-16">
      <section className="w-full max-w-3xl rounded-3xl border border-violet-100 bg-white p-5 shadow-[0_20px_60px_-32px_rgba(54,36,104,0.28)] sm:p-12">
        <div className="text-center">
          <p className="text-sm font-semibold tracking-widest text-violet-700 uppercase">BandUp</p>
          <h1 className="mt-3 text-3xl sm:mt-4 sm:text-4xl font-semibold tracking-tight text-zinc-900">Dashboard</h1>
          {isLoading ? (
            <p className="mt-4 text-zinc-600">Verificando sua sessão...</p>
          ) : loadError ? (
            <p role="alert" className="mt-5 text-sm text-red-700">{loadError}</p>
          ) : user ? (
            <p className="mt-3 break-words text-sm text-zinc-500 sm:break-normal">{user.email}</p>
          ) : (
            <div className="mt-5">
              <p className="text-zinc-600">Nenhuma sessão autenticada foi encontrada.</p>
              <Link href="/login" className="mt-5 inline-flex w-full items-center justify-center rounded-xl bg-violet-700 sm:w-auto px-5 py-3 text-sm font-semibold text-white transition hover:bg-violet-800">
                Ir para o login
              </Link>
            </div>
          )}
        </div>

        {!isLoading && !loadError && user && (
          bands.length === 0 ? (
            <div className="mt-6 rounded-2xl bg-violet-50 px-4 py-6 text-center sm:mt-10 sm:px-6 sm:py-8">
              <h2 className="text-xl font-semibold text-zinc-900">Sua jornada começa com uma banda</h2>
              <p className="mx-auto mt-3 max-w-md text-sm leading-6 text-zinc-600">
                Você ainda não participa de nenhuma banda. Crie a primeira para organizar tudo em um só lugar.
              </p>
              <Link href="/bandas/nova" className="mt-6 inline-flex w-full items-center justify-center rounded-xl bg-violet-700 sm:w-auto px-5 py-3 text-sm font-semibold text-white transition hover:bg-violet-800">
                Criar minha banda
              </Link>
            </div>
          ) : (
            <div className="mt-6 sm:mt-10">
              <div className="flex flex-wrap items-center justify-between gap-2 sm:gap-3">
                <h2 className="text-xl font-semibold text-zinc-900">Suas bandas</h2>
                <Link href="/bandas/nova" className="inline-flex min-h-11 items-center justify-center rounded-xl border border-violet-200 px-3 text-sm font-semibold text-violet-700 hover:text-violet-900 sm:inline sm:min-h-0 sm:rounded-none sm:border-0 sm:px-0">
                  Criar outra banda
                </Link>
              </div>
              <ul className="mt-4 space-y-3">
                {bands.map(({ band, role }, index) => band && (
                  <li key={band.id ?? index}>
                    <Link
                      href={`/bandas/${band.id}`}
                      className="block rounded-2xl border border-violet-100 p-4 sm:p-5 transition hover:border-violet-300 hover:bg-violet-50/50 focus:outline-none focus:ring-4 focus:ring-violet-100"
                    >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <h3 className="break-words text-lg font-semibold text-zinc-900 sm:break-normal">{band.name}</h3>
                      <span className="rounded-full bg-violet-50 px-3 py-1 text-xs font-semibold text-violet-700">
                        {role === "admin" ? "Administrador" : "Membro"}
                      </span>
                    </div>
                    <p className="mt-2 break-words text-sm leading-6 text-zinc-600 sm:break-normal">
                      {band.description?.trim() || "Nenhuma descrição informada."}
                    </p>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )
        )}

        {logoutError && <p role="alert" className="mt-5 text-center text-sm text-red-700">{logoutError}</p>}
        {user && !isLoading && (
          <div className="mt-6 text-center sm:mt-8">
            <button
              type="button"
              onClick={handleSignOut}
              disabled={isLoggingOut}
              className="inline-flex w-full items-center justify-center rounded-xl border border-violet-200 px-5 py-3 text-sm font-semibold text-violet-800 transition hover:bg-violet-50 disabled:cursor-not-allowed disabled:opacity-70 sm:w-auto"
            >
              {isLoggingOut ? "Saindo..." : "Sair"}
            </button>
          </div>
        )}
      </section>
    </main>
  );
}
