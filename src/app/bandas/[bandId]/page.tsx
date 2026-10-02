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
type CardState = "loading" | "error" | "ready";
type SummaryData = {
  tasks: { total: number; pending: number; completed: number } | null;
  event: { title: string; event_type: string; start_at: string; location: string | null } | null;
  members: number | null;
};

const navigationItems = [
  { label: "Visão geral", active: true },
  { label: "Tarefas", active: false },
  { label: "Agenda", active: false },
  { label: "Membros", active: false },
  { label: "Links", active: false },
  { label: "Configurações", active: false },
];

const eventTypes = [
  { value: "show", label: "Show" },
  { value: "rehearsal", label: "Ensaio" },
  { value: "recording", label: "Gravação" },
  { value: "meeting", label: "Reunião" },
  { value: "interview", label: "Entrevista" },
  { value: "other", label: "Outro" },
];

function getEventTypeLabel(eventType: string) {
  return eventTypes.find((type) => type.value === eventType)?.label ?? "Outro";
}

function formatEventDate(value: string) {
  return new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "long", year: "numeric" }).format(new Date(value));
}

function formatEventTime(value: string) {
  return new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(value));
}

function BandNavigation({
  bandId,
  mobile = false,
  onNavigate,
}: {
  bandId: string;
  mobile?: boolean;
  onNavigate?: () => void;
}) {
  return (
    <nav aria-label="Navegação da banda">
      <ul className={mobile ? "grid grid-cols-2 gap-2" : "space-y-1"}>
        {navigationItems.map((item) => (
          <li key={item.label}>
            {item.active || item.label === "Tarefas" || item.label === "Agenda" || item.label === "Membros" || item.label === "Links" ? (
              <Link
                href={item.active
                  ? `/bandas/${bandId}`
                  : item.label === "Tarefas"
                    ? `/bandas/${bandId}/tarefas`
                    : item.label === "Agenda"
                      ? `/bandas/${bandId}/agenda`
                      : item.label === "Membros"
                        ? `/bandas/${bandId}/membros`
                        : `/bandas/${bandId}/links`}
                onClick={onNavigate}
                aria-current={item.active ? "page" : undefined}
                className={`flex min-h-11 items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold ${
                  item.active
                    ? mobile
                      ? "bg-violet-700 text-white"
                      : "bg-violet-50 text-violet-800"
                    : mobile
                      ? "border border-violet-200 bg-white text-violet-800"
                      : "text-zinc-600 transition hover:bg-violet-50 hover:text-violet-800"
                }`}
              >
                <span aria-hidden="true" className={`h-2 w-2 rounded-full ${item.active ? "bg-violet-500" : "bg-zinc-300"}`} />
                {item.label}
              </Link>
            ) : (
              <span
                aria-disabled="true"
                className={`flex min-h-11 items-center justify-between gap-2 rounded-xl px-3 py-2.5 text-sm text-zinc-500 ${
                  mobile ? "border border-zinc-200 bg-white" : ""
                }`}
              >
                {item.label}
                <span className="shrink-0 rounded-full bg-zinc-100 px-2 py-0.5 text-[9px] font-semibold tracking-wide text-zinc-500 uppercase">
                  Em breve
                </span>
              </span>
            )}
          </li>
        ))}
      </ul>
    </nav>
  );
}

export default function BandPage() {
  const { bandId } = useParams<{ bandId: string }>();
  const [band, setBand] = useState<Band | null>(null);
  const [pageState, setPageState] = useState<PageState>("loading");
  const [isMobileNavOpen, setIsMobileNavOpen] = useState(false);
  const [summary, setSummary] = useState<SummaryData>({ tasks: null, event: null, members: null });
  const [cardStates, setCardStates] = useState<Record<"tasks" | "event" | "members", CardState>>({ tasks: "loading", event: "loading", members: "loading" });

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

        const now = new Date().toISOString();
        const [tasksResult, eventResult, membersResult] = await Promise.allSettled([
          supabase.from("tasks").select("status").eq("band_id", bandId),
          supabase.from("events").select("title, event_type, start_at, location")
            .eq("band_id", bandId).gte("start_at", now).order("start_at", { ascending: true }).limit(1).maybeSingle(),
          supabase.from("band_members").select("user_id", { count: "exact", head: true }).eq("band_id", bandId),
        ]);

        if (!isMounted) return;
        if (tasksResult.status === "fulfilled" && !tasksResult.value.error) {
          const tasks = tasksResult.value.data ?? [];
          const completed = tasks.filter((task) => task.status === "done").length;
          setSummary((current) => ({ ...current, tasks: {
            total: tasks.length,
            pending: tasks.filter((task) => task.status === "todo" || task.status === "in_progress").length,
            completed,
          } }));
          setCardStates((current) => ({ ...current, tasks: "ready" }));
        } else setCardStates((current) => ({ ...current, tasks: "error" }));

        if (eventResult.status === "fulfilled" && !eventResult.value.error) {
          setSummary((current) => ({ ...current, event: eventResult.value.data }));
          setCardStates((current) => ({ ...current, event: "ready" }));
        } else setCardStates((current) => ({ ...current, event: "error" }));

        if (membersResult.status === "fulfilled" && !membersResult.value.error && membersResult.value.count !== null) {
          setSummary((current) => ({ ...current, members: membersResult.value.count }));
          setCardStates((current) => ({ ...current, members: "ready" }));
        } else setCardStates((current) => ({ ...current, members: "error" }));
      } catch {
        if (isMounted) setPageState("error");
      }
    }

    void loadBand();
    return () => {
      isMounted = false;
    };
  }, [bandId]);

  if (pageState !== "ready" || !band) {
    return (
      <main className="flex flex-1 justify-center px-4 py-8 sm:px-6 sm:py-12">
        <section className="w-full max-w-2xl">
          <Link
            href="/dashboard"
            className="inline-flex min-h-11 items-center rounded-xl border border-violet-200 px-4 py-2.5 text-sm font-semibold text-violet-800 transition hover:bg-violet-50 focus:outline-none focus:ring-4 focus:ring-violet-100"
          >
            ← Voltar para minhas bandas
          </Link>

          {pageState === "loading" ? (
            <div className="mt-6 rounded-3xl border border-violet-100 bg-white p-8 text-center shadow-[0_20px_60px_-32px_rgba(54,36,104,0.28)] sm:p-10">
              <p className="text-zinc-600">Carregando sua banda...</p>
            </div>
          ) : pageState === "unauthenticated" ? (
            <div className="mt-6 rounded-3xl border border-violet-100 bg-white p-8 text-center shadow-[0_20px_60px_-32px_rgba(54,36,104,0.28)] sm:p-10">
              <h1 className="text-2xl font-semibold text-zinc-900">Entre para continuar</h1>
              <p className="mt-3 text-sm text-zinc-600">Faça login para acessar suas bandas.</p>
              <Link href="/login" className="mt-6 inline-flex min-h-11 items-center rounded-xl bg-violet-700 px-5 py-3 text-sm font-semibold text-white transition hover:bg-violet-800">
                Ir para o login
              </Link>
            </div>
          ) : pageState === "unavailable" ? (
            <div className="mt-6 rounded-3xl border border-violet-100 bg-white p-8 text-center shadow-[0_20px_60px_-32px_rgba(54,36,104,0.28)] sm:p-10">
              <h1 className="text-2xl font-semibold text-zinc-900">Banda não encontrada</h1>
              <p className="mt-3 text-sm text-zinc-600">
                Essa banda não existe ou você não tem acesso a ela.
              </p>
            </div>
          ) : (
            <div role="alert" className="mt-6 rounded-3xl border border-red-200 bg-red-50 p-8 text-center text-sm text-red-700 sm:p-10">
              Não foi possível carregar essa banda agora. Tente novamente.
            </div>
          )}
        </section>
      </main>
    );
  }

  return (
    <main className="flex min-w-0 flex-1 flex-col md:flex-row">
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-r border-violet-100 bg-white px-5 py-6 md:flex lg:w-72 lg:px-6">
        <Link href="/dashboard" className="text-xl font-bold tracking-tight text-zinc-900">
          Band<span className="text-violet-700">Up</span>
        </Link>

        <div className="mt-10 min-w-0 rounded-2xl bg-violet-50 p-4">
          <p className="text-[11px] font-semibold tracking-[0.16em] text-violet-600 uppercase">Banda ativa</p>
          <p className="mt-2 break-words text-base font-semibold text-zinc-900">{band.name}</p>
          <p className="mt-1 text-xs text-zinc-500">
            {band.role === "admin" ? "Administrador" : "Membro"}
          </p>
        </div>

        <div className="mt-8">
          <p className="mb-3 px-3 text-[11px] font-semibold tracking-[0.16em] text-zinc-400 uppercase">Workspace</p>
          <BandNavigation bandId={band.id} />
        </div>

        <Link
          href="/dashboard"
          className="mt-auto flex min-h-11 items-center rounded-xl px-3 text-sm font-medium text-zinc-600 transition hover:bg-violet-50 hover:text-violet-800"
        >
          ← Voltar para minhas bandas
        </Link>
      </aside>

      <div className="min-w-0 flex-1">
        <header className="sticky top-0 z-20 border-b border-violet-100 bg-white/95 px-4 py-3 backdrop-blur md:hidden">
          <div className="flex min-w-0 items-center justify-between gap-3">
            <div className="min-w-0">
              <Link href="/dashboard" className="text-lg font-bold tracking-tight text-zinc-900">
                Band<span className="text-violet-700">Up</span>
              </Link>
              <p className="truncate text-xs text-zinc-500">{band.name}</p>
            </div>
            <button
              type="button"
              aria-expanded={isMobileNavOpen}
              aria-controls="mobile-band-navigation"
              aria-label={isMobileNavOpen ? "Fechar navegação da banda" : "Abrir navegação da banda"}
              onClick={() => setIsMobileNavOpen((isOpen) => !isOpen)}
              className="flex min-h-11 shrink-0 items-center gap-2 rounded-xl border border-violet-200 px-3 text-sm font-semibold text-violet-800 transition hover:bg-violet-50 focus:outline-none focus:ring-4 focus:ring-violet-100"
            >
              <span aria-hidden="true" className="text-lg leading-none">{isMobileNavOpen ? "×" : "☰"}</span>
              <span>{isMobileNavOpen ? "Fechar" : "Menu"}</span>
            </button>
          </div>
          {isMobileNavOpen && (
            <div id="mobile-band-navigation" className="mt-3 border-t border-violet-100 pt-3">
              <BandNavigation
                bandId={band.id}
                mobile
                onNavigate={() => setIsMobileNavOpen(false)}
              />
              <Link
                href="/dashboard"
                onClick={() => setIsMobileNavOpen(false)}
                className="mt-2 flex min-h-11 items-center rounded-xl px-3 text-sm font-medium text-zinc-600 transition hover:bg-violet-50 hover:text-violet-800"
              >
                ← Voltar para minhas bandas
              </Link>
            </div>
          )}
        </header>

        <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 sm:py-8 lg:px-10 lg:py-10">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <p className="text-xs font-semibold tracking-[0.16em] text-violet-700 uppercase">Visão geral</p>
              <h1 className="mt-2 break-words text-3xl font-semibold tracking-tight text-zinc-900 sm:text-4xl">
                {band.name}
              </h1>
              {band.description?.trim() && (
                <p className="mt-3 max-w-2xl break-words text-sm leading-6 text-zinc-600 sm:text-base">
                  {band.description}
                </p>
              )}
            </div>
            <span className="inline-flex w-fit shrink-0 rounded-full border border-violet-200 bg-violet-50 px-3.5 py-2 text-xs font-semibold text-violet-800">
              {band.role === "admin" ? "Administrador" : "Membro"}
            </span>
          </div>

          <section aria-label="Resumo da banda" className="mt-7 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 lg:gap-4">
            <article className="min-w-0 rounded-2xl border border-violet-100 bg-white p-5 shadow-[0_12px_36px_-28px_rgba(54,36,104,0.35)] sm:p-6">
              <p className="text-sm font-medium text-zinc-600">Tarefas</p>
              {cardStates.tasks === "loading" ? <p className="mt-4 text-sm text-zinc-500">Carregando tarefas...</p> : cardStates.tasks === "error" ? <p role="status" className="mt-4 text-sm text-red-700">Não foi possível carregar as tarefas.</p> : <>
                <p className="mt-4 text-2xl font-semibold tracking-tight text-zinc-900">{summary.tasks?.total} no total</p>
                <p className="mt-2 text-sm text-zinc-600">{summary.tasks?.pending} pendentes</p>
                <p className="mt-1 text-sm text-zinc-600">{summary.tasks?.completed} concluídas</p>
              </>}
              <Link href={`/bandas/${band.id}/tarefas`} className="mt-5 inline-flex min-h-11 items-center text-sm font-semibold text-violet-800 hover:text-violet-950">Ver tarefas <span aria-hidden="true" className="ml-1">→</span></Link>
            </article>
            <article className="min-w-0 rounded-2xl border border-violet-100 bg-white p-5 shadow-[0_12px_36px_-28px_rgba(54,36,104,0.35)] sm:p-6">
              <p className="text-sm font-medium text-zinc-600">Próximos eventos</p>
              {cardStates.event === "loading" ? <p className="mt-4 text-sm text-zinc-500">Carregando agenda...</p> : cardStates.event === "error" ? <p role="status" className="mt-4 text-sm text-red-700">Não foi possível carregar a agenda.</p> : summary.event ? <>
                <h2 className="mt-4 break-words text-lg font-semibold text-zinc-900">{summary.event.title}</h2>
                <p className="mt-1 text-xs font-semibold tracking-wide text-violet-700 uppercase">{getEventTypeLabel(summary.event.event_type)}</p>
                <p className="mt-3 text-sm text-zinc-700">{formatEventDate(summary.event.start_at)} às {formatEventTime(summary.event.start_at)}</p>
                {summary.event.location?.trim() && <p className="mt-1 break-words text-sm text-zinc-600">{summary.event.location}</p>}
              </> : <p className="mt-4 text-sm text-zinc-600">Nenhum próximo evento</p>}
              <Link href={`/bandas/${band.id}/agenda`} className="mt-5 inline-flex min-h-11 items-center text-sm font-semibold text-violet-800 hover:text-violet-950">Ver agenda <span aria-hidden="true" className="ml-1">→</span></Link>
            </article>
            <article className="min-w-0 rounded-2xl border border-violet-100 bg-white p-5 shadow-[0_12px_36px_-28px_rgba(54,36,104,0.35)] sm:p-6">
              <p className="text-sm font-medium text-zinc-600">Membros</p>
              {cardStates.members === "loading" ? <p className="mt-4 text-sm text-zinc-500">Carregando integrantes...</p> : cardStates.members === "error" ? <p role="status" className="mt-4 text-sm text-red-700">Não foi possível carregar os integrantes.</p> : <p className="mt-4 text-3xl font-semibold tracking-tight text-zinc-900">{summary.members} {summary.members === 1 ? "integrante" : "integrantes"}</p>}
              <Link href={`/bandas/${band.id}/membros`} className="mt-5 inline-flex min-h-11 items-center text-sm font-semibold text-violet-800 hover:text-violet-950">Ver membros <span aria-hidden="true" className="ml-1">→</span></Link>
            </article>
          </section>
        </div>
      </div>
    </main>
  );
}
