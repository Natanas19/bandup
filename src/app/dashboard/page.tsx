"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import WelcomeOnboarding from "@/components/welcome-onboarding";
import NavigationIcon from "@/components/navigation-icon";
import { BAND_ENTRY_BACKEND_VALIDATED } from "@/lib/band-entry";
import type { User } from "@supabase/supabase-js";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { normalizeDisplayName } from "@/lib/display-name";
import { loadPersonalTasks, PersonalTasksLoadError, type PersonalTask } from "@/lib/personal-tasks";
import { loadPersonalAgenda, PersonalAgendaLoadError, type PersonalEvent } from "@/lib/personal-agenda";
import { formatTaskDate } from "@/lib/date-time";
import { BandDeletionRecovery } from "@/components/band-deletion-panel";
import { BandInvitations } from "@/components/band-invitations";

type BandMembership = { role: string; band: { id: string; name: string } | null };

function previewEvents(events: PersonalEvent[]) {
  const now = Date.now();
  const upcoming = events.filter(event => Date.parse(event.start_at) >= now)
    .sort((a, b) => Date.parse(a.start_at) - Date.parse(b.start_at));
  const ordered = upcoming.length ? upcoming : [...events].sort((a, b) => Date.parse(b.start_at) - Date.parse(a.start_at));
  return ordered.slice(0, 3);
}

const dateFormatter = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short" });
const timeFormatter = new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

function eventDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Data indisponível" : dateFormatter.format(date);
}

function eventTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Horário indisponível" : timeFormatter.format(date);
}

function accountName(user: User) {
  return normalizeDisplayName(user.user_metadata?.display_name)
    ?? normalizeDisplayName(user.user_metadata?.full_name)
    ?? normalizeDisplayName(user.user_metadata?.name);
}

function retryButton(onClick: () => void) {
  return <button type="button" onClick={onClick} className="mt-3 min-h-10 rounded-xl border border-accent-border px-3 py-2 text-sm font-semibold text-brand hover:bg-accent-soft focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-focus">Tentar novamente</button>;
}

export default function DashboardPage() {
  const [user, setUser] = useState<User | null>(null);
  const [bands, setBands] = useState<BandMembership[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [tasks, setTasks] = useState<PersonalTask[] | null>(null);
  const [taskCount, setTaskCount] = useState<number | null>(null);
  const [tasksError, setTasksError] = useState("");
  const [agenda, setAgenda] = useState<PersonalEvent[] | null>(null);
  const [agendaError, setAgendaError] = useState("");
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    let active = true;
    setIsLoading(true);
    setLoadError("");
    setTasks(null); setTaskCount(null); setTasksError(""); setAgenda(null); setAgendaError("");

    async function loadDashboard() {
      try {
        const supabase = getSupabaseBrowserClient();
        const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
        if (!active) return;
        if (sessionError) { setLoadError("Não foi possível carregar sua conta agora. Tente novamente."); return; }
        const session = sessionData.session;
        if (!session) { setUser(null); return; }
        // Read current metadata: the profile editor intentionally keeps its
        // isolated Auth writes out of the shared SDK session cache.
        const { data: account, error: accountError } = await supabase.auth.getUser();
        if (!active) return;
        if (accountError || !account.user || account.user.id !== session.user.id) {
          setLoadError("Não foi possível verificar sua conta agora. Tente novamente."); return;
        }
        setUser(account.user);

        const { data, error } = await supabase.from("band_members")
          .select("role, band:bands!inner(id, name)")
          .eq("user_id", session.user.id);
        if (!active) return;
        if (error) { setLoadError("Não foi possível carregar suas bandas agora. Tente novamente."); return; }
        const memberships = ((data ?? []) as unknown as BandMembership[])
          .filter(item => (item.role === "admin" || item.role === "member")
            && item.band?.id && item.band.name.trim());
        setBands(memberships);

        if (!memberships.length) {
          setTasks([]); setTaskCount(0); setAgenda([]);
          return;
        }

        void loadPersonalTasks(supabase).then(result => {
          if (active) { setTasks(result.tasks); setTaskCount(result.totalCount); }
        }).catch(cause => {
          if (!active) return;
          setTasksError(cause instanceof PersonalTasksLoadError ? cause.message : "Não foi possível carregar suas tarefas. Tente novamente.");
        });
        void loadPersonalAgenda(supabase).then(result => {
          if (active) setAgenda(result);
        }).catch(cause => {
          if (!active) return;
          setAgendaError(cause instanceof PersonalAgendaLoadError ? cause.message : "Não foi possível carregar sua agenda. Tente novamente.");
        });
      } catch {
        if (active) setLoadError("Não foi possível carregar sua conta agora. Tente novamente.");
      } finally {
        if (active) setIsLoading(false);
      }
    }

    void loadDashboard();
    return () => { active = false; };
  }, [revision]);

  const displayName = user ? accountName(user) : null;
  const content = <main className="min-w-0 flex-1 px-4 py-5 sm:px-6 sm:py-8 lg:px-10 lg:py-10">
    <div className="mx-auto w-full max-w-7xl">
      <BandDeletionRecovery />
      {isLoading ? <section aria-busy="true" className="mt-8 rounded-panel border border-outline bg-surface p-6 sm:p-8"><p role="status" className="text-sm text-content-muted">Carregando seu espaço...</p></section>
        : loadError ? <section className="mt-8 rounded-panel border border-danger-border bg-surface p-6 sm:p-8"><p role="alert" className="text-sm text-danger">{loadError}</p>{retryButton(() => setRevision(value => value + 1))}</section>
          : !user ? <section className="mt-8 rounded-panel border border-outline bg-surface p-6 text-center sm:p-10">
            <h1 className="text-2xl font-semibold text-content">Entre no seu espaço</h1>
            <p className="mt-2 text-sm text-content-muted">Nenhuma sessão autenticada foi encontrada.</p>
            <Link href="/login" className="mt-5 inline-flex min-h-11 items-center justify-center rounded-control bg-primary px-5 py-3 text-sm font-semibold text-on-primary hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-focus">Ir para o login</Link>
          </section> : <>
            <section className="relative mt-8 overflow-hidden rounded-panel border border-accent-border bg-surface p-6 shadow-app-dashboard sm:p-8 lg:flex lg:items-end lg:justify-between lg:gap-8 lg:px-10 lg:py-9">
              <div aria-hidden="true" className="pointer-events-none absolute -right-12 -top-20 h-56 w-56 rounded-full bg-accent/10 blur-3xl" />
              <div className="relative max-w-3xl">
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-accent">Seu espaço, seu ritmo</p>
                <h1 className="mt-3 text-3xl font-semibold leading-tight tracking-tight text-content sm:text-4xl lg:text-5xl">
                  {displayName ? `Boas-vindas, ${displayName}.` : "Boas-vindas ao seu espaço."}
                </h1>
                <p className="mt-3 max-w-2xl text-sm leading-6 text-content-muted sm:text-base">Acompanhe o que está acontecendo nas bandas de que você participa.</p>
              </div>
              {bands.length > 0 && <Link href="/dashboard/bandas" className="workspace-primary-action relative mt-5 inline-flex min-h-11 items-center gap-2 rounded-control border border-outline px-4 py-2 text-sm font-semibold text-content hover:border-accent-border hover:bg-accent-soft focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-focus lg:mt-0">Ver minhas bandas <NavigationIcon name="Users" className="h-4 w-4" /></Link>}
            </section>

            <Link href="/dashboard/perfil" className="workspace-primary-action mt-6 inline-flex min-h-11 items-center rounded-control border border-accent-border px-4 py-2 text-sm font-semibold text-brand hover:bg-accent-soft focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-focus">Gerenciar meu perfil</Link>

            {bands.length === 0 && <section className="mt-6 grid gap-6 rounded-panel border border-accent-border bg-accent-soft/40 p-5 sm:p-7 lg:grid-cols-[auto_minmax(0,1fr)_auto] lg:items-center lg:gap-7 lg:p-8">
              <div aria-hidden="true" className="flex h-14 w-14 items-center justify-center rounded-panel border border-accent-border bg-surface text-accent"><NavigationIcon name="Users" className="h-7 w-7" /></div>
              <div>
                <h2 className="text-xl font-semibold text-content sm:text-2xl">Seu espaço começa com uma banda</h2>
                <p className="mt-2 max-w-2xl text-sm leading-6 text-content-muted">Crie uma banda ou pesquise uma para acompanhar tarefas, eventos e novidades em um só lugar.</p>
              </div>
              <div className="grid gap-3 sm:grid-cols-2 lg:min-w-64 lg:grid-cols-1">
                <Link href="/bandas/nova" className="inline-flex min-h-11 items-center justify-center rounded-control bg-primary px-5 py-3 text-sm font-semibold text-on-primary hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-focus">Criar banda</Link>
                <Link href="/descobrir" aria-describedby="discovery-availability" className="inline-flex min-h-11 items-center justify-center rounded-control border border-accent-border bg-surface px-5 py-3 text-sm font-semibold text-brand hover:bg-accent-soft focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-focus">Pesquisar banda</Link>
              </div>
              <p id="discovery-availability" className="text-xs leading-5 text-content-muted lg:col-start-2">{BAND_ENTRY_BACKEND_VALIDATED ? "Pesquise pelo nome de uma banda e acompanhe suas solicitações de entrada." : "A busca e o envio de solicitações ainda estão indisponíveis enquanto validamos a funcionalidade."}</p>
            </section>}

            <BandInvitations key={user.id} onAccepted={() => setRevision(value => value + 1)} />
            <div className="mt-6 grid gap-5 xl:grid-cols-[minmax(0,1.1fr)_minmax(20rem,0.9fr)]">
              <section aria-labelledby="personal-tasks-title" className="min-w-0 rounded-panel border border-outline bg-surface p-5 shadow-app-card sm:p-6 lg:p-7">
                <header className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-widest text-accent">Em todas as suas bandas</p>
                    <h2 id="personal-tasks-title" className="mt-2 text-xl font-semibold text-content sm:text-2xl">Minhas tarefas</h2>
                  </div>
                  <span className="rounded-full bg-accent-soft px-3 py-1 text-sm font-bold tabular-nums text-accent">{taskCount ?? "—"}</span>
                </header>
                {tasksError ? <div className="mt-5"><p role="alert" className="text-sm text-danger">{tasksError}</p>{retryButton(() => setRevision(value => value + 1))}</div>
                  : tasks === null ? <p role="status" className="mt-5 text-sm text-content-muted">Carregando suas tarefas...</p>
                    : tasks.length === 0 ? <p className="mt-5 rounded-control border border-dashed border-outline px-4 py-5 text-sm leading-6 text-content-muted">Nenhuma tarefa atribuída a você no momento.</p>
                      : <ul className="mt-5 divide-y divide-outline-subtle">{tasks.slice(0, 4).map(task => <li key={`${task.band_id}:${task.id}`} className="py-4 first:pt-0 last:pb-0">
                        <Link href={`/bandas/${task.band_id}/tarefas`} className="group block rounded-control focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-focus">
                          <p className="text-xs font-semibold text-accent">{task.bandName}</p>
                          <div className="mt-1 flex items-start justify-between gap-3"><h3 className="min-w-0 break-words font-semibold text-content group-hover:text-brand">{task.title}</h3><NavigationIcon name="ArrowUpRight" className="mt-0.5 h-4 w-4 text-content-faint" /></div>
                          <p className="mt-1 text-xs text-content-muted">{task.due_date ? `Prazo: ${formatTaskDate(task.due_date)}` : "Sem prazo definido"}</p>
                        </Link>
                      </li>)}</ul>}
                <Link href="/dashboard/tarefas" className="mt-5 inline-flex min-h-11 items-center gap-2 rounded-control px-3 text-sm font-semibold text-brand hover:bg-accent-soft focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-focus">Ver todas as tarefas <span aria-hidden="true">→</span></Link>
              </section>

              <section aria-labelledby="personal-agenda-title" className="min-w-0 rounded-panel border border-outline bg-surface p-5 shadow-app-card sm:p-6 lg:p-7">
                <header className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-widest text-accent">Próximos momentos</p>
                    <h2 id="personal-agenda-title" className="mt-2 text-xl font-semibold text-content sm:text-2xl">Minha agenda</h2>
                  </div>
                  <span className="rounded-full bg-accent-soft px-3 py-1 text-sm font-bold tabular-nums text-accent">{agenda ? agenda.length : "—"}</span>
                </header>
                {agendaError ? <div className="mt-5"><p role="alert" className="text-sm text-danger">{agendaError}</p>{retryButton(() => setRevision(value => value + 1))}</div>
                  : agenda === null ? <p role="status" className="mt-5 text-sm text-content-muted">Carregando sua agenda...</p>
                    : agenda.length === 0 ? <p className="mt-5 rounded-control border border-dashed border-outline px-4 py-5 text-sm leading-6 text-content-muted">Ainda não há eventos das suas bandas na agenda.</p>
                      : <ul className="mt-5 space-y-3">{previewEvents(agenda).map(event => <li key={`${event.band_id}:${event.id}`}>
                        <Link href={`/bandas/${event.band_id}/agenda`} className="flex min-w-0 gap-3 rounded-control border border-outline-subtle bg-surface-muted p-3 transition hover:border-accent-border hover:bg-accent-soft/50 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-focus sm:p-4">
                          <span className="flex w-14 shrink-0 flex-col items-center justify-center rounded-control bg-accent-soft px-2 py-2 text-center"><span className="text-xs font-semibold uppercase text-accent">{eventDate(event.start_at)}</span><span className="mt-1 text-xs tabular-nums text-content-muted">{eventTime(event.start_at)}</span></span>
                          <span className="min-w-0 flex-1"><span className="block break-words font-semibold text-content">{event.title}</span><span className="mt-1 block break-words text-xs font-semibold text-accent">{event.bandName}</span>{event.location?.trim() && <span className="mt-1 block break-words text-xs text-content-muted">{event.location}</span>}</span>
                        </Link>
                      </li>)}</ul>}
                <Link href="/dashboard/agenda" className="mt-5 inline-flex min-h-11 items-center gap-2 rounded-control px-3 text-sm font-semibold text-brand hover:bg-accent-soft focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-focus">Ver agenda completa <span aria-hidden="true">→</span></Link>
              </section>
            </div>
          </>}
    </div>
  </main>;

  return !isLoading && !loadError && user
    ? <WelcomeOnboarding key={user.id} userId={user.id}>{content}</WelcomeOnboarding>
    : content;
}
