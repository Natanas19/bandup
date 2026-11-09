"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { loadPersonalTasks, PERSONAL_TASK_PAGE_SIZE, PersonalTasksLoadError, type PersonalTasksPage } from "@/lib/personal-tasks";
import { formatTaskDate } from "@/lib/date-time";

const statusLabels: Record<string, string> = { todo: "A fazer", in_progress: "Em andamento", done: "Concluída" };
const priorityLabels: Record<string, string> = { low: "Baixa", medium: "Média", high: "Alta" };
const button = "inline-flex min-h-11 items-center justify-center rounded-xl border border-accent-border px-4 py-3 text-sm font-semibold text-brand hover:bg-accent-soft focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-focus disabled:cursor-not-allowed disabled:opacity-50";

export default function PersonalTasks() {
  const [page, setPage] = useState<PersonalTasksPage | null>(null);
  const [error, setError] = useState("");
  const [offset, setOffset] = useState(0);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    setPage(null); setError("");
    void (async () => {
      try {
        const result = await loadPersonalTasks(getSupabaseBrowserClient(), offset);
        if (active) setPage(result);
      } catch (cause) {
        if (active) setError(cause instanceof PersonalTasksLoadError ? cause.message : "Não foi possível carregar suas tarefas. Tente novamente.");
      }
    })();
    return () => { active = false; };
  }, [offset, revision]);
  return <main className="min-w-0 flex-1 px-4 py-6 sm:px-6 sm:py-8 lg:px-10 lg:py-10">
    <div className="mx-auto w-full max-w-4xl">
      <header>
        <p className="text-xs font-semibold uppercase tracking-widest text-accent">Meu Painel</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-content sm:text-4xl">Tarefas</h1>
        <p className="mt-3 text-sm leading-6 text-content-muted">Suas tarefas atribuídas, reunidas de todas as suas bandas.</p>
      </header>
      {error ? <section className="mt-7 rounded-2xl border border-nav-border bg-surface p-5">
        <p role="alert" className="text-sm text-danger">{error}</p>
        <button type="button" className={`${button} mt-4`} onClick={() => setRevision(value => value + 1)}>Tentar novamente</button>
      </section> : !page ? <p role="status" className="mt-7 text-sm text-content-muted">Carregando suas tarefas...</p> : <>
        {!page.tasks.length ? <section className="mt-7 rounded-2xl border border-dashed border-accent-border bg-surface p-6 sm:p-10">
          <h2 className="text-xl font-semibold text-content">{offset ? "Nenhuma tarefa nesta página" : "Nenhuma tarefa atribuída a você"}</h2>
          <p className="mt-3 text-sm leading-6 text-content-muted">Quando uma tarefa de uma das suas bandas for atribuída a você, ela aparecerá aqui.</p>
        </section> : <ul className="mt-7 space-y-4">{page.tasks.map(task => <li key={task.id}>
          <article className="min-w-0 rounded-2xl border border-nav-border bg-surface p-5 shadow-app-card sm:p-6">
            <p className="break-words text-sm font-semibold text-accent [overflow-wrap:anywhere]">{task.bandName}</p>
            <h2 className="mt-2 break-words text-xl font-semibold text-content [overflow-wrap:anywhere]">{task.title}</h2>
            <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-3">
              <div><dt className="text-content-muted">Status</dt><dd className="mt-1 font-semibold text-content">{task.status ? statusLabels[task.status] ?? "Não informado" : "Não informado"}</dd></div>
              <div><dt className="text-content-muted">Prioridade</dt><dd className="mt-1 font-semibold text-content">{task.priority ? priorityLabels[task.priority] ?? "Não informada" : "Não informada"}</dd></div>
              <div><dt className="text-content-muted">Prazo</dt><dd className="mt-1 font-semibold text-content">{task.due_date ? formatTaskDate(task.due_date) : "Sem prazo"}</dd></div>
            </dl>
            <Link href={`/bandas/${task.band_id}/tarefas`} className={`${button} mt-5`} aria-label={`Abrir tarefas da banda ${task.bandName}`}>Abrir tarefas da banda</Link>
          </article>
        </li>)}</ul>}
        {(offset > 0 || page.hasMore) && <nav aria-label="Páginas de tarefas" className="mt-6 flex flex-wrap gap-3">
          <button type="button" className={button} disabled={offset === 0} onClick={() => setOffset(value => Math.max(0, value - PERSONAL_TASK_PAGE_SIZE))}>Anteriores</button>
          <button type="button" className={button} disabled={!page.hasMore} onClick={() => setOffset(value => value + PERSONAL_TASK_PAGE_SIZE)}>Próximas</button>
        </nav>}
      </>}
      <Link href="/dashboard" className={`${button} mt-6`}>Voltar à visão geral</Link>
    </div>
  </main>;
}
