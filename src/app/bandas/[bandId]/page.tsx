"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

type Band = {
  id: string;
  name: string;
  description: string | null;
  role: string;
};

type PageState = "loading" | "unauthenticated" | "unavailable" | "error" | "ready";

const navigationItems = [
  "Visão geral",
  "Tarefas",
  "Agenda",
  "Membros",
  "Links",
  "Configurações",
];

export default function BandPage() {
  const { bandId } = useParams<{ bandId: string }>();
  const [band, setBand] = useState<Band | null>(null);
  const [pageState, setPageState] = useState<PageState>("loading");

  useEffect(() => {
    let isMounted = true;

    async function loadBand() {
      setPageState("loading");
      setBand(null);

      try {
        const supabase = getSupabaseBrowserClient();
        const { data: sessionData, error: sessionError } = await supabase.auth.getSession();

        if (!isMounted) return;
        if (sessionError) {
          setPageState("error");
          return;
        }

        const user = sessionData.session?.user;
        if (!user) {
          setPageState("unauthenticated");
          return;
        }

        const { data: membership, error: membershipError } = await supabase
          .from("band_members")
          .select("role")
          .eq("band_id", bandId)
          .eq("user_id", user.id)
          .maybeSingle();

        if (!isMounted) return;
        if (membershipError) {
          setPageState("error");
          return;
        }
        if (!membership) {
          setPageState("unavailable");
          return;
        }

        const { data: bandData, error: bandError } = await supabase
          .from("bands")
          .select("id, name, description")
          .eq("id", bandId)
          .maybeSingle();

        if (!isMounted) return;
        if (bandError) {
          setPageState("error");
          return;
        }
        if (!bandData) {
          setPageState("unavailable");
          return;
        }

        setBand({ ...bandData, role: membership.role });
        setPageState("ready");
      } catch {
        if (isMounted) setPageState("error");
      }
    }

    void loadBand();
    return () => {
      isMounted = false;
    };
  }, [bandId]);

  return (
    <main className="flex flex-1 justify-center px-6 py-12 sm:py-16">
      <section className="w-full max-w-5xl">
        <Link
          href="/dashboard"
          className="inline-flex rounded-xl border border-violet-200 px-4 py-2.5 text-sm font-semibold text-violet-800 transition hover:bg-violet-50 focus:outline-none focus:ring-4 focus:ring-violet-100"
        >
          ← Voltar para minhas bandas
        </Link>

        {pageState === "loading" ? (
          <div className="mt-8 rounded-3xl border border-violet-100 bg-white p-10 text-center shadow-[0_20px_60px_-32px_rgba(54,36,104,0.28)]">
            <p className="text-zinc-600">Carregando sua banda...</p>
          </div>
        ) : pageState === "unauthenticated" ? (
          <div className="mt-8 rounded-3xl border border-violet-100 bg-white p-10 text-center shadow-[0_20px_60px_-32px_rgba(54,36,104,0.28)]">
            <h1 className="text-2xl font-semibold text-zinc-900">Entre para continuar</h1>
            <p className="mt-3 text-sm text-zinc-600">Faça login para acessar suas bandas.</p>
            <Link href="/login" className="mt-6 inline-flex rounded-xl bg-violet-700 px-5 py-3 text-sm font-semibold text-white transition hover:bg-violet-800">
              Ir para o login
            </Link>
          </div>
        ) : pageState === "unavailable" ? (
          <div className="mt-8 rounded-3xl border border-violet-100 bg-white p-10 text-center shadow-[0_20px_60px_-32px_rgba(54,36,104,0.28)]">
            <h1 className="text-2xl font-semibold text-zinc-900">Banda não encontrada</h1>
            <p className="mt-3 text-sm text-zinc-600">
              Essa banda não existe ou você não tem acesso a ela.
            </p>
          </div>
        ) : pageState === "error" || !band ? (
          <div role="alert" className="mt-8 rounded-3xl border border-red-200 bg-red-50 p-10 text-center text-sm text-red-700">
            Não foi possível carregar essa banda agora. Tente novamente.
          </div>
        ) : (
          <div className="mt-8 overflow-hidden rounded-3xl border border-violet-100 bg-white shadow-[0_20px_60px_-32px_rgba(54,36,104,0.28)]">
            <header className="bg-gradient-to-br from-violet-700 via-violet-800 to-indigo-950 px-8 py-10 text-white sm:px-10">
              <p className="text-sm font-semibold tracking-widest text-violet-200 uppercase">BandUp · Banda ativa</p>
              <div className="mt-5 flex flex-wrap items-start justify-between gap-4">
                <div>
                  <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">{band.name}</h1>
                  <p className="mt-3 max-w-2xl text-sm leading-6 text-violet-100/85">
                    {band.description?.trim() || "Nenhuma descrição informada."}
                  </p>
                </div>
                <span className="rounded-full border border-white/20 bg-white/10 px-4 py-2 text-sm font-semibold text-white">
                  {band.role === "admin" ? "Administrador" : "Membro"}
                </span>
              </div>
            </header>

            <div className="p-6 sm:p-8">
              <nav aria-label="Navegação da banda">
                <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
                  {navigationItems.map((item, index) => (
                    <li key={item}>
                      {index === 0 ? (
                        <span aria-current="page" className="flex h-full min-h-16 items-center justify-center rounded-xl bg-violet-700 px-3 py-3 text-center text-sm font-semibold text-white">
                          {item}
                        </span>
                      ) : (
                        <span aria-disabled="true" className="flex h-full min-h-16 flex-col items-center justify-center gap-1 rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-3 text-center text-sm font-medium text-zinc-500">
                          {item}
                          <span className="text-[10px] font-semibold tracking-wide text-violet-600 uppercase">Em breve</span>
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </nav>

              <section className="mt-8 rounded-2xl bg-violet-50/70 p-6">
                <h2 className="text-lg font-semibold text-zinc-900">Visão geral</h2>
                <p className="mt-2 text-sm leading-6 text-zinc-600">
                  Este é o espaço de trabalho de {band.name}. As ferramentas da banda serão disponibilizadas aqui.
                </p>
              </section>
            </div>
          </div>
        )}
      </section>
    </main>
  );
}
