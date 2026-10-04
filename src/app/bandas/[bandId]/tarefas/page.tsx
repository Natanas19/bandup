"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { LinkifiedText } from "@/components/linkified-text";

type TaskStatus = "todo" | "in_progress" | "done";
type TaskPriority = "low" | "medium" | "high";

type BandEvent = {
  id: string;
  title: string;
  start_at: string;
};

type Task = {
  id: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  due_date: string | null;
  assigned_to: string | null;
  event_id: string | null;
  created_at: string;
};

type BandMember = {
  userId: string;
  label: string;
};

type PageState = "loading" | "unauthenticated" | "unavailable" | "error" | "ready";

const statusOptions: { value: TaskStatus; label: string }[] = [
  { value: "todo", label: "A fazer" },
  { value: "in_progress", label: "Em andamento" },
  { value: "done", label: "Concluída" },
];

const priorityOptions: { value: TaskPriority; label: string }[] = [
  { value: "low", label: "Baixa" },
  { value: "medium", label: "Média" },
  { value: "high", label: "Alta" },
];

const statusStyles: Record<TaskStatus, string> = {
  todo: "bg-zinc-100 text-zinc-700",
  in_progress: "bg-amber-100 text-amber-800",
  done: "bg-emerald-100 text-emerald-800",
};

const priorityStyles: Record<TaskPriority, string> = {
  low: "bg-sky-50 text-sky-700",
  medium: "bg-violet-50 text-violet-700",
  high: "bg-rose-50 text-rose-700",
};

function sortTasks(tasks: Task[]) {
  return [...tasks].sort((first, second) => {
    const completedOrder = Number(first.status === "done") - Number(second.status === "done");
    if (completedOrder !== 0) return completedOrder;

    const firstDueDate = first.due_date ? Date.parse(first.due_date) : Number.POSITIVE_INFINITY;
    const secondDueDate = second.due_date ? Date.parse(second.due_date) : Number.POSITIVE_INFINITY;
    if (firstDueDate !== secondDueDate) return firstDueDate - secondDueDate;

    return Date.parse(second.created_at) - Date.parse(first.created_at);
  });
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "medium" }).format(new Date(value));
}

function formatEventDate(value: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  }).format(new Date(value));
}

function formatEventTime(value: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(value));
}

function getStatusLabel(status: TaskStatus) {
  return statusOptions.find((option) => option.value === status)?.label ?? status;
}

function getPriorityLabel(priority: TaskPriority) {
  return priorityOptions.find((option) => option.value === priority)?.label ?? priority;
}

export default function BandTasksPage() {
  const { bandId } = useParams<{ bandId: string }>();
  const [pageState, setPageState] = useState<PageState>("loading");
  const [bandName, setBandName] = useState("");
  const [isAdmin, setIsAdmin] = useState(false);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [events, setEvents] = useState<BandEvent[]>([]);
  const [members, setMembers] = useState<BandMember[]>([]);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [formError, setFormError] = useState("");
  const [formSuccess, setFormSuccess] = useState("");
  const [deleteError, setDeleteError] = useState("");
  const [deletingTaskId, setDeletingTaskId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState<TaskStatus>("todo");
  const [priority, setPriority] = useState<TaskPriority>("medium");
  const [dueDate, setDueDate] = useState("");
  const [assignedTo, setAssignedTo] = useState("");
  const [relatedEventId, setRelatedEventId] = useState("");

  useEffect(() => {
    let isMounted = true;

    async function loadTasksPage() {
      setPageState("loading");
      setLoadError("");

      try {
        const supabase = getSupabaseBrowserClient();
        const { data: sessionData, error: sessionError } = await supabase.auth.getSession();

        if (!isMounted) return;
        if (sessionError) {
          setPageState("error");
          setLoadError("Não foi possível verificar sua sessão. Tente novamente.");
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
          setLoadError("Não foi possível verificar seu acesso à banda. Tente novamente.");
          return;
        }
        if (!membership) {
          setPageState("unavailable");
          return;
        }

        const { data: band, error: bandError } = await supabase
          .from("bands")
          .select("name")
          .eq("id", bandId)
          .maybeSingle();

        if (!isMounted) return;
        if (bandError || !band) {
          setPageState(bandError ? "error" : "unavailable");
          setLoadError(bandError ? "Não foi possível carregar a banda. Tente novamente." : "");
          return;
        }

        const { data: memberRows, error: membersError } = await supabase
          .from("band_members")
          .select("user_id")
          .eq("band_id", bandId)
          .order("user_id");

        if (!isMounted) return;
        if (membersError) {
          setPageState("error");
          setLoadError("Não foi possível carregar os membros da banda. Tente novamente.");
          return;
        }

        const bandMembers = (memberRows ?? []).map((member, index) => ({
          userId: member.user_id,
          label: member.user_id === user.id ? "Você" : `Integrante ${index + 1}`,
        }));

        const { data: eventRows, error: eventsError } = await supabase
          .from("events")
          .select("id, title, start_at")
          .eq("band_id", bandId)
          .order("start_at", { ascending: true });

        if (!isMounted) return;
        if (eventsError) {
          setPageState("error");
          setLoadError("Não foi possível carregar os eventos da banda. Tente novamente.");
          return;
        }

        const { data: taskRows, error: tasksError } = await supabase
          .from("tasks")
          .select("id, title, description, status, priority, due_date, assigned_to, event_id, created_at")
          .eq("band_id", bandId)
          .order("due_date", { ascending: true, nullsFirst: false })
          .order("created_at", { ascending: false });

        if (!isMounted) return;
        if (tasksError) {
          setPageState("error");
          setLoadError("Não foi possível carregar as tarefas. Tente novamente.");
          return;
        }

        setBandName(band.name);
        setIsAdmin(membership.role === "admin");
        setMembers(bandMembers);
        setEvents((eventRows ?? []) as BandEvent[]);
        setTasks(sortTasks((taskRows ?? []) as unknown as Task[]));
        setPageState("ready");
      } catch {
        if (isMounted) {
          setPageState("error");
          setLoadError("Não foi possível carregar as tarefas. Tente novamente.");
        }
      }
    }

    void loadTasksPage();
    return () => {
      isMounted = false;
    };
  }, [bandId]);

  function resetForm() {
    setTitle("");
    setDescription("");
    setStatus("todo");
    setPriority("medium");
    setDueDate("");
    setAssignedTo("");
    setRelatedEventId("");
    setFormError("");
    setFormSuccess("");
  }

  function cancelEditing() {
    setEditingTaskId(null);
    resetForm();
    setIsFormOpen(false);
  }

  function startEditing(task: Task) {
    setEditingTaskId(task.id);
    setTitle(task.title);
    setDescription(task.description ?? "");
    setStatus(task.status);
    setPriority(task.priority);
    if (task.due_date) {
      const date = new Date(task.due_date);
      setDueDate(`${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`);
    } else setDueDate("");
    setAssignedTo(task.assigned_to ?? "");
    setRelatedEventId(task.event_id ?? "");
    setFormError("");
    setFormSuccess("");
    setIsFormOpen(true);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function handleCreateTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSubmitting) return;

    setFormError("");
    setFormSuccess("");
    setIsSubmitting(true);

    try {
      const supabase = getSupabaseBrowserClient();
      const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
      const user = sessionData.session?.user;

      if (sessionError || !user) {
        setFormError("Sessao expirada. Entre novamente para continuar.");
        return;
      }

      const { data: membership, error: membershipError } = await supabase
        .from("band_members")
        .select("user_id")
        .eq("band_id", bandId)
        .eq("user_id", user.id)
        .maybeSingle();

      if (membershipError || !membership) {
        setFormError("Você não tem mais acesso a esta banda.");
        return;
      }

      if (assignedTo && !members.some((member) => member.userId === assignedTo)) {
        setFormError("Selecione um responsável que faça parte desta banda.");
        return;
      }

      if (relatedEventId && !events.some((bandEvent) => bandEvent.id === relatedEventId)) {
        setFormError("Selecione um evento que pertença a esta banda.");
        return;
      }

      const dueDateValue = dueDate
        ? new Date(`${dueDate}T12:00:00`).toISOString()
        : null;

      const taskValues = {
        title: title.trim(),
        description: description.trim() || null,
        status,
        priority,
        due_date: dueDateValue,
        assigned_to: assignedTo || null,
        event_id: relatedEventId || null,
      };

      if (editingTaskId) {
        const { data: updatedTask, error } = await supabase
          .from("tasks")
          .update({ ...taskValues, updated_at: new Date().toISOString() })
          .eq("id", editingTaskId)
          .eq("band_id", bandId)
          .select("id, title, description, status, priority, due_date, assigned_to, event_id, created_at")
          .maybeSingle();

        if (error || !updatedTask) {
          setFormError("Nao foi possivel salvar as alteracoes. Confira os dados e tente novamente.");
          return;
        }

        setTasks((currentTasks) => sortTasks(currentTasks.map((task) =>
          task.id === editingTaskId ? updatedTask as unknown as Task : task
        )));
        setEditingTaskId(null);
        resetForm();
        setFormSuccess("Tarefa atualizada com sucesso.");
        setIsFormOpen(false);
        return;
      }

      const { data: createdTask, error } = await supabase
        .from("tasks")
        .insert({
          band_id: bandId,
          created_by: user.id,
          ...taskValues,
        })
        .select("id, title, description, status, priority, due_date, assigned_to, event_id, created_at")
        .single();

      if (error || !createdTask) {
          setFormError("Nao foi possivel salvar as alteracoes. Confira os dados e tente novamente.");
        return;
      }

      setTasks((currentTasks) => sortTasks([...currentTasks, createdTask as unknown as Task]));
      resetForm();
      setIsFormOpen(false);
    } catch {
      setFormError("Não foi possível salvar a tarefa agora. Tente novamente.");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleDeleteTask(task: Task) {
    if (deletingTaskId || !window.confirm(`Excluir a tarefa "${task.title}"? Esta ação não pode ser desfeita.`)) return;

    setDeleteError("");
    setDeletingTaskId(task.id);

    try {
      const supabase = getSupabaseBrowserClient();
      const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
      const user = sessionData.session?.user;

      if (sessionError || !user) {
        setDeleteError("Sua sessão expirou. Entre novamente para excluir uma tarefa.");
        return;
      }

      const { data: membership, error: membershipError } = await supabase
        .from("band_members")
        .select("role")
        .eq("band_id", bandId)
        .eq("user_id", user.id)
        .maybeSingle();

      if (membershipError || membership?.role !== "admin") {
        setDeleteError("Somente administradores da banda podem excluir tarefas.");
        return;
      }

      const { data: deletedTask, error: deleteTaskError } = await supabase
        .from("tasks")
        .delete()
        .eq("id", task.id)
        .eq("band_id", bandId)
        .select("id")
        .maybeSingle();

      if (deleteTaskError || !deletedTask) {
        setDeleteError("Não foi possível excluir a tarefa. Tente novamente.");
        return;
      }

      setTasks((currentTasks) => currentTasks.filter((currentTask) => currentTask.id !== task.id));
    } catch {
      setDeleteError("Não foi possível excluir a tarefa agora. Tente novamente.");
    } finally {
      setDeletingTaskId(null);
    }
  }

  if (pageState !== "ready") {
    return (
      <main className="flex flex-1 justify-center px-4 py-8 sm:px-6 sm:py-12">
        <section className="w-full max-w-3xl">
          <Link href={`/bandas/${bandId}`} className="inline-flex min-h-11 items-center rounded-xl border border-violet-200 px-4 py-2.5 text-sm font-semibold text-violet-800 transition hover:bg-violet-50">
            ← Voltar para a banda
          </Link>
          <div className="mt-6 rounded-3xl border border-violet-100 bg-white p-8 text-center shadow-[0_20px_60px_-32px_rgba(54,36,104,0.28)] sm:p-10">
            {pageState === "loading" ? (
              <p className="text-zinc-600">Carregando tarefas...</p>
            ) : pageState === "unauthenticated" ? (
              <>
                <h1 className="text-2xl font-semibold text-zinc-900">Entre para continuar</h1>
                <p className="mt-3 text-sm text-zinc-600">Faça login para acessar as tarefas da banda.</p>
                <Link href="/login" className="mt-6 inline-flex min-h-11 items-center rounded-xl bg-violet-700 px-5 py-3 text-sm font-semibold text-white transition hover:bg-violet-800">
                  Ir para o login
                </Link>
              </>
            ) : pageState === "unavailable" ? (
              <>
                <h1 className="text-2xl font-semibold text-zinc-900">Banda não encontrada</h1>
                <p className="mt-3 text-sm text-zinc-600">Essa banda não existe ou você não tem acesso a ela.</p>
              </>
            ) : (
              <p role="alert" className="text-sm text-red-700">{loadError}</p>
            )}
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="flex flex-1 justify-center px-4 py-6 sm:px-6 sm:py-10">
      <div className="w-full max-w-5xl min-w-0">
        <Link href={`/bandas/${bandId}`} className="inline-flex min-h-11 items-center rounded-xl border border-violet-200 px-4 py-2.5 text-sm font-semibold text-violet-800 transition hover:bg-violet-50 focus:outline-none focus:ring-4 focus:ring-violet-100">
          ← Voltar para a visão geral
        </Link>

        <header className="mt-7 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0">
            <p className="text-xs font-semibold tracking-[0.16em] text-violet-700 uppercase">{bandName}</p>
            <h1 className="mt-2 break-words text-3xl font-semibold tracking-tight text-zinc-900 sm:text-4xl">Tarefas</h1>
            <p className="mt-2 text-sm leading-6 text-zinc-600">Organize o que precisa ser feito pela banda.</p>
          </div>
          <button
            type="button"
            onClick={() => {
              if (editingTaskId) cancelEditing();
              else if (isFormOpen) {
                resetForm();
                setIsFormOpen(false);
              } else {
                setFormError("");
                setFormSuccess("");
                setIsFormOpen(true);
              }
            }}
            className="inline-flex min-h-11 w-full shrink-0 items-center justify-center rounded-xl bg-violet-700 px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-violet-700/15 transition hover:bg-violet-800 focus:outline-none focus:ring-4 focus:ring-violet-200 sm:w-auto"
          >
            {isFormOpen ? "Fechar formulário" : "+ Nova tarefa"}
          </button>
        </header>

        {isFormOpen && (
          <section className="mt-6 rounded-2xl border border-violet-100 bg-white p-5 shadow-[0_16px_48px_-32px_rgba(54,36,104,0.35)] sm:p-7">
            <div className="mb-5">
              <h2 className="text-lg font-semibold text-zinc-900">{editingTaskId ? "Editar tarefa" : "Nova tarefa"}</h2>
              <p className="mt-1 text-sm text-zinc-500">Os campos com * são obrigatórios.</p>
            </div>
            <form onSubmit={handleCreateTask} className="space-y-5">
              <div>
                <label htmlFor="task-title" className="mb-2 block text-sm font-medium text-zinc-700">Título *</label>
                <input
                  id="task-title"
                  type="text"
                  required
                  maxLength={200}
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  className="min-h-11 w-full rounded-xl border border-zinc-200 px-4 py-3 text-sm text-zinc-900 outline-none transition placeholder:text-zinc-400 focus:border-violet-500 focus:ring-4 focus:ring-violet-100"
                  placeholder="Ex.: Definir repertório do próximo ensaio"
                />
              </div>

              <div>
                <label htmlFor="task-description" className="mb-2 block text-sm font-medium text-zinc-700">Descrição <span className="font-normal text-zinc-400">(opcional)</span></label>
                <textarea
                  id="task-description"
                  rows={3}
                  maxLength={2000}
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  className="w-full resize-y rounded-xl border border-zinc-200 px-4 py-3 text-sm text-zinc-900 outline-none transition placeholder:text-zinc-400 focus:border-violet-500 focus:ring-4 focus:ring-violet-100"
                  placeholder="Adicione detalhes para a banda"
                />
              </div>

              <div>
                <label htmlFor="task-event" className="mb-2 block text-sm font-medium text-zinc-700">Evento relacionado (opcional)</label>
                <select
                  id="task-event"
                  value={relatedEventId}
                  onChange={(event) => setRelatedEventId(event.target.value)}
                  className="min-h-11 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2.5 text-sm text-zinc-900 outline-none focus:border-violet-500 focus:ring-4 focus:ring-violet-100"
                >
                  <option value="">Nenhum evento</option>
                  {events.map((bandEvent) => (
                    <option key={bandEvent.id} value={bandEvent.id}>
                      {bandEvent.title} — {formatEventDate(bandEvent.start_at)} às {formatEventTime(bandEvent.start_at)}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <div>
                  <label htmlFor="task-status" className="mb-2 block text-sm font-medium text-zinc-700">Status</label>
                  <select id="task-status" value={status} onChange={(event) => setStatus(event.target.value as TaskStatus)} className="min-h-11 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2.5 text-sm text-zinc-900 outline-none focus:border-violet-500 focus:ring-4 focus:ring-violet-100">
                    {statusOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </select>
                </div>
                <div>
                  <label htmlFor="task-priority" className="mb-2 block text-sm font-medium text-zinc-700">Prioridade</label>
                  <select id="task-priority" value={priority} onChange={(event) => setPriority(event.target.value as TaskPriority)} className="min-h-11 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2.5 text-sm text-zinc-900 outline-none focus:border-violet-500 focus:ring-4 focus:ring-violet-100">
                    {priorityOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </select>
                </div>
                <div>
                  <label htmlFor="task-due-date" className="mb-2 block text-sm font-medium text-zinc-700">Prazo <span className="font-normal text-zinc-400">(opcional)</span></label>
                  <input id="task-due-date" type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} className="min-h-11 w-full min-w-0 rounded-xl border border-zinc-200 bg-white px-3 py-2.5 text-sm text-zinc-900 outline-none focus:border-violet-500 focus:ring-4 focus:ring-violet-100" />
                </div>
                <div>
                  <label htmlFor="task-assignee" className="mb-2 block text-sm font-medium text-zinc-700">Responsável <span className="font-normal text-zinc-400">(opcional)</span></label>
                  <select id="task-assignee" value={assignedTo} onChange={(event) => setAssignedTo(event.target.value)} className="min-h-11 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2.5 text-sm text-zinc-900 outline-none focus:border-violet-500 focus:ring-4 focus:ring-violet-100">
                    <option value="">Sem responsável</option>
                    {members.map((member) => <option key={member.userId} value={member.userId}>{member.label}</option>)}
                  </select>
                </div>
              </div>

              {formError && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{formError}</p>}

              <div className="flex flex-col-reverse gap-3 pt-1 sm:flex-row sm:justify-end">
                <button type="button" disabled={isSubmitting} onClick={cancelEditing} className="min-h-11 rounded-xl border border-violet-200 px-5 py-3 text-sm font-semibold text-violet-800 transition hover:bg-violet-50 disabled:opacity-60">
                  {editingTaskId ? "Cancelar edição" : "Cancelar"}
                </button>
                <button type="submit" disabled={isSubmitting} className="min-h-11 rounded-xl bg-violet-700 px-5 py-3 text-sm font-semibold text-white transition hover:bg-violet-800 disabled:cursor-not-allowed disabled:opacity-70">
                  {isSubmitting ? (editingTaskId ? "Salvando alterações..." : "Criando tarefa...") : editingTaskId ? "Salvar alterações" : "Criar tarefa"}
                </button>
              </div>
            </form>
          </section>
        )}

        {formSuccess && <p role="status" className="mt-5 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{formSuccess}</p>}
        {deleteError && <p role="alert" className="mt-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{deleteError}</p>}

        {tasks.length === 0 ? (
          <section className="mt-6 rounded-2xl border border-dashed border-violet-200 bg-white px-5 py-10 text-center sm:py-14">
            <div aria-hidden="true" className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-violet-50 text-violet-700">
              <span className="text-xl">✓</span>
            </div>
            <h2 className="mt-4 text-lg font-semibold text-zinc-900">Nenhuma tarefa criada ainda.</h2>
            <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-zinc-600">Crie uma tarefa para combinar o próximo passo da banda.</p>
            {!isFormOpen && (
              <button type="button" onClick={() => setIsFormOpen(true)} className="mt-5 inline-flex min-h-11 items-center rounded-xl bg-violet-700 px-5 py-3 text-sm font-semibold text-white transition hover:bg-violet-800">
                Criar primeira tarefa
              </button>
            )}
          </section>
        ) : (
          <section aria-label="Lista de tarefas" className="mt-6 space-y-3">
            {tasks.map((task) => {
              const assignee = task.assigned_to
                ? members.find((member) => member.userId === task.assigned_to)?.label ?? "Membro da banda"
                : null;

              return (
                <article key={task.id} className="min-w-0 rounded-2xl border border-violet-100 bg-white p-5 shadow-[0_12px_36px_-28px_rgba(54,36,104,0.35)] sm:p-6">
                  <div className="flex min-w-0 flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <h2 className="break-words text-base font-semibold text-zinc-900 sm:text-lg">{task.title}</h2>
                      {task.description?.trim() && <p className="mt-2 break-words whitespace-pre-wrap text-sm leading-6 text-zinc-600"><LinkifiedText text={task.description} /></p>}
                    </div>
                    <div className="flex shrink-0 flex-wrap gap-2 sm:justify-end">
                      <span className={`rounded-full px-3 py-1 text-xs font-semibold ${statusStyles[task.status]}`}>{getStatusLabel(task.status)}</span>
                      <span className={`rounded-full px-3 py-1 text-xs font-semibold ${priorityStyles[task.priority]}`}>{getPriorityLabel(task.priority)}</span>
                    </div>
                  </div>
                  {(task.due_date || assignee) && (
                    <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 border-t border-zinc-100 pt-3 text-xs text-zinc-500">
                      {task.due_date && <p>Prazo: <span className="font-medium text-zinc-700">{formatDate(task.due_date)}</span></p>}
                      {assignee && <p>Responsável: <span className="font-medium text-zinc-700">{assignee}</span></p>}
                    </div>
                  )}
                  {task.event_id && <p className="mt-2 text-xs text-zinc-500">Evento: <span className="font-medium text-zinc-700">{events.find((bandEvent) => bandEvent.id === task.event_id)?.title ?? "Evento da banda"}</span></p>}
                  <div className="mt-4 flex flex-col-reverse gap-2 border-t border-zinc-100 pt-3 sm:flex-row sm:justify-end">
                    <button
                      type="button"
                      onClick={() => startEditing(task)}
                      disabled={isSubmitting || deletingTaskId !== null}
                      className="inline-flex min-h-10 items-center justify-center rounded-xl border border-violet-200 px-4 py-2 text-sm font-semibold text-violet-800 transition hover:bg-violet-50 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      Editar
                    </button>
                    {isAdmin && (
                      <button
                        type="button"
                        onClick={() => void handleDeleteTask(task)}
                        disabled={deletingTaskId !== null}
                        className="inline-flex min-h-10 items-center rounded-xl border border-red-200 px-4 py-2 text-sm font-semibold text-red-700 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {deletingTaskId === task.id ? "Excluindo..." : "Excluir"}
                      </button>
                    )}
                  </div>
                </article>
              );
            })}
          </section>
        )}
      </div>
    </main>
  );
}
