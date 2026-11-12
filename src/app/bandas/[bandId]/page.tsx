"use client";

import { readLegacyBandOverview } from "@/lib/legacy-band-data";
import { useEffect, useState } from "react";
import Link from "next/link";
import BandNavigation from "@/components/band-navigation";
import { BandWorkspaceInfo } from "@/components/band-workspace";
import { useParams } from "next/navigation";
import { isTaskOverdue, watchPageClock } from "@/lib/date-time";
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
  tasks: { total: number; pending: number; completed: number; overdue: number } | null;
  event: { title: string; event_type: string; start_at: string; location: string | null } | null;
  members: number | null;
};

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

export default function BandPage() {
  const { bandId } = useParams<{ bandId: string }>();
  const [band, setBand] = useState<Band | null>(null);
  const [pageState, setPageState] = useState<PageState>("loading");
  const [summary, setSummary] = useState<SummaryData>({ tasks: null, event: null, members: null });
  const [cardStates, setCardStates] = useState<Record<"tasks" | "event" | "members", CardState>>({ tasks: "loading", event: "loading", members: "loading" });

  const [deadlineTasks, setDeadlineTasks] = useState<{ status: string; due_date: string | null }[]>([]);
  const [currentTime, setCurrentTime] = useState(0);

  useEffect(() => watchPageClock(setCurrentTime), []);

  useEffect(() => {
    let isMounted = true;

    async function loadBand() {
      setPageState("loading");
      setBand(null);
      setDeadlineTasks([]);

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

        const { data: bandData, error: bandError } = await readLegacyBandOverview(supabase, bandId);

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
          supabase.from("tasks").select("status, due_date").eq("band_id", bandId),
          supabase.from("events").select("title, event_type, start_at, location")
            .eq("band_id", bandId).gte("start_at", now).order("start_at", { ascending: true }).limit(1).maybeSingle(),
          supabase.from("band_members").select("user_id", { count: "exact", head: true }).eq("band_id", bandId),
        ]);

        if (!isMounted) return;
        if (tasksResult.status === "fulfilled" && !tasksResult.value.error) {
          const tasks = tasksResult.value.data ?? [];
          setDeadlineTasks(tasks);
          const completed = tasks.filter((task) => task.status === "done").length;
          const overdue = tasks.filter((task) =>
            isTaskOverdue(task, Date.now())
          ).length;
          setSummary((current) => ({ ...current, tasks: {
            total: tasks.length,
            pending: tasks.filter((task) => task.status === "todo" || task.status === "in_progress").length,
            completed,
            overdue,
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
            className="inline-flex min-h-11 items-center rounded-xl border border-accent-border px-4 py-2.5 text-sm font-semibold text-brand transition hover:bg-accent-soft focus:outline-none focus:ring-4 focus:ring-input-ring"
          >
            ← Voltar ao Meu Painel
          </Link>

          {pageState === "loading" ? (
            <div className="mt-6 rounded-3xl border border-nav-border bg-surface p-8 text-center shadow-app-dashboard sm:p-10">
              <p className="text-content-muted">Carregando sua banda...</p>
            </div>
          ) : pageState === "unauthenticated" ? (
            <div className="mt-6 rounded-3xl border border-nav-border bg-surface p-8 text-center shadow-app-dashboard sm:p-10">
              <h1 className="text-2xl font-semibold text-content">Entre para continuar</h1>
              <p className="mt-3 text-sm text-content-muted">Faça login para acessar suas bandas.</p>
              <Link href="/login" className="mt-6 inline-flex min-h-11 items-center rounded-xl bg-primary px-5 py-3 text-sm font-semibold text-on-primary transition hover:bg-primary-hover">
                Ir para o login
              </Link>
            </div>
          ) : pageState === "unavailable" ? (
            <div className="mt-6 rounded-3xl border border-nav-border bg-surface p-8 text-center shadow-app-dashboard sm:p-10">
              <h1 className="text-2xl font-semibold text-content">Banda não encontrada</h1>
              <p className="mt-3 text-sm text-content-muted">
                Essa banda não existe ou você não tem acesso a ela.
              </p>
            </div>
          ) : (
            <div role="alert" className="mt-6 rounded-3xl border border-danger-border bg-danger-surface p-8 text-center text-sm text-danger sm:p-10">
              Não foi possível carregar essa banda agora. Tente novamente.
            </div>
          )}
        </section>
      </main>
    );
  }

  return (
    <main className="flex min-w-0 flex-1 flex-col">


      <BandWorkspaceInfo name={band.name} role={band.role} />
      <div className="min-w-0 flex-1">
        <BandNavigation bandId={band.id} activeSection="overview" />

        <div className="mx-auto w-full max-w-6xl px-4 py-5 sm:px-6 sm:py-8 lg:px-10 lg:py-10">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0 sm:flex-1">
              <p className="text-xs font-semibold tracking-[0.16em] text-accent uppercase">Visão geral</p>
              <h1 title={band.name} className="mt-2 line-clamp-2 break-words text-2xl font-semibold tracking-tight text-content [overflow-wrap:anywhere] sm:line-clamp-none sm:text-4xl sm:[overflow-wrap:normal]">
                {band.name}
              </h1>
              {band.name.length > 32 && (
                <details className="mt-2 text-sm text-content-muted sm:hidden">
                  <summary className="w-fit cursor-pointer rounded-lg py-2 font-medium text-brand focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">
                    Ver nome completo
                  </summary>
                  <p className="mt-1 select-text rounded-xl bg-accent-soft p-3 [overflow-wrap:anywhere]">{band.name}</p>
                </details>
              )}
              {band.description?.trim() && (
                <p className="mt-3 max-w-2xl break-words text-sm leading-6 text-content-muted sm:text-base">
                  {band.description}
                </p>
              )}
            </div>
            <span className="inline-flex w-fit shrink-0 rounded-full border border-accent-border bg-accent-soft px-3.5 py-2 text-xs font-semibold text-brand">
              {band.role === "admin" ? "Administrador" : "Membro"}
            </span>
          </div>



          <section aria-label="Resumo da banda" className="mt-5 grid grid-cols-1 gap-3 sm:mt-7 sm:grid-cols-2 lg:grid-cols-3 lg:gap-4">
            <article className="min-w-0 rounded-2xl border border-nav-border bg-surface p-4 shadow-app-card sm:p-6">
              <p className="text-sm font-medium text-content-muted">Tarefas</p>
              {cardStates.tasks === "loading" ? <p className="mt-4 text-sm text-content-subtle">Carregando tarefas...</p> : cardStates.tasks === "error" ? <p role="status" className="mt-4 text-sm text-danger">Não foi possível carregar as tarefas.</p> : <>
                <p className="mt-4 text-2xl font-semibold tracking-tight text-content">{summary.tasks?.total} no total</p>
                <p className="mt-2 text-sm text-content-muted">{summary.tasks?.pending} pendentes</p>
                <p className="mt-1 text-sm text-content-muted">{summary.tasks?.completed} concluídas</p>
                <p className="mt-1 text-sm font-medium text-danger">{deadlineTasks.filter((task) => isTaskOverdue(task, currentTime)).length} atrasadas</p>
              </>}
              <Link href={`/bandas/${band.id}/tarefas`} className="mt-5 inline-flex min-h-11 items-center text-sm font-semibold text-brand hover:text-brand-hover focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-focus">Ver tarefas <span aria-hidden="true" className="ml-1">→</span></Link>
            </article>
            <article className="min-w-0 rounded-2xl border border-nav-border bg-surface p-4 shadow-app-card sm:p-6">
              <p className="text-sm font-medium text-content-muted">Próximos eventos</p>
              {cardStates.event === "loading" ? <p className="mt-4 text-sm text-content-subtle">Carregando agenda...</p> : cardStates.event === "error" ? <p role="status" className="mt-4 text-sm text-danger">Não foi possível carregar a agenda.</p> : summary.event ? <>
                <h2 className="mt-4 break-words text-lg font-semibold text-content">{summary.event.title}</h2>
                <p className="mt-1 text-xs font-semibold tracking-wide text-accent uppercase">{getEventTypeLabel(summary.event.event_type)}</p>
                <p className="mt-3 text-sm text-content-label">{formatEventDate(summary.event.start_at)} às {formatEventTime(summary.event.start_at)}</p>
                {summary.event.location?.trim() && <p className="mt-1 break-words text-sm text-content-muted">{summary.event.location}</p>}
              </> : <p className="mt-4 text-sm text-content-muted">Nenhum próximo evento</p>}
              <Link href={`/bandas/${band.id}/agenda`} className="mt-5 inline-flex min-h-11 items-center text-sm font-semibold text-brand hover:text-brand-hover focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-focus">Ver agenda <span aria-hidden="true" className="ml-1">→</span></Link>
            </article>
            <article className="min-w-0 rounded-2xl border border-nav-border bg-surface p-4 shadow-app-card sm:p-6">
              <p className="text-sm font-medium text-content-muted">Membros</p>
              {cardStates.members === "loading" ? <p className="mt-4 text-sm text-content-subtle">Carregando integrantes...</p> : cardStates.members === "error" ? <p role="status" className="mt-4 text-sm text-danger">Não foi possível carregar os integrantes.</p> : <p className="mt-4 text-3xl font-semibold tracking-tight text-content">{summary.members} {summary.members === 1 ? "integrante" : "integrantes"}</p>}
              <Link href={`/bandas/${band.id}/membros`} className="mt-5 inline-flex min-h-11 items-center text-sm font-semibold text-brand hover:text-brand-hover focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-focus">Ver membros <span aria-hidden="true" className="ml-1">→</span></Link>
            </article>
          </section>
        </div>
      </div>
    </main>
  );
}
