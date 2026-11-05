"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import BandNavigation from "@/components/band-navigation";
import { BandWorkspaceInfo } from "@/components/band-workspace";
import { useParams } from "next/navigation";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import CardDetails, { toggleCardDetails } from "@/components/card-details";
import { calendarDay, formatTaskDate, taskDeadlinePatch } from "@/lib/date-time";
import { requiredTextError } from "@/lib/form-validation";
import { canEditTask, canReassignTask, canSaveTask, getBandAccess, recordWriteError } from "@/lib/record-permissions";
import { readTasksWithEventSupport, taskColumns, taskEventValues } from "@/lib/task-event-compatibility";

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
  event_id?: string | null;
  created_at: string;
  created_by: string;
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
  todo: "bg-disabled-surface text-content-label",
  in_progress: "bg-warning-badge text-warning",
  done: "bg-success-badge text-success",
};

const priorityStyles: Record<TaskPriority, string> = {
  low: "bg-info-surface text-info",
  medium: "bg-accent-soft text-accent",
  high: "bg-danger-soft text-danger-emphasis",
};

function sortTasks(tasks: Task[]) {
  return [...tasks].sort((first, second) => {
    const completedOrder = Number(first.status === "done") - Number(second.status === "done");
    if (completedOrder !== 0) return completedOrder;

    const firstDueDate = first.due_date ? Number(calendarDay(first.due_date).replaceAll("-", "")) : Number.POSITIVE_INFINITY;
    const secondDueDate = second.due_date ? Number(calendarDay(second.due_date).replaceAll("-", "")) : Number.POSITIVE_INFINITY;
    if (firstDueDate !== secondDueDate) return firstDueDate - secondDueDate;

    return Date.parse(second.created_at) - Date.parse(first.created_at);
  });
}

function formatDate(value: string) {
  return formatTaskDate(value);
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
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [supportsEvents, setSupportsEvents] = useState(true);
  const access = getBandAccess(currentUserId, isAdmin ? "admin" : "member");
  const editingTask = tasks.find((task) => task.id === editingTaskId);
  const canChangeAssignee = !editingTaskId || (!!editingTask && canReassignTask(access, editingTask));

  useEffect(() => {
    let isMounted = true;

    async function loadTasksPage() {
      setPageState("loading");
      setCurrentUserId(null);
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

        const { data: taskRows, error: tasksError, supportsEvents: hasEventSupport } =
          await readTasksWithEventSupport(supabase, bandId);

        if (!isMounted) return;
        if (tasksError) {
          setPageState("error");
          setLoadError("Não foi possível carregar as tarefas. Tente novamente.");
          return;
        }

        const { data: eventRows, error: eventsError } = hasEventSupport ? await supabase
          .from("events")
          .select("id, title, start_at")
          .eq("band_id", bandId)
          .order("start_at", { ascending: true }) : { data: [], error: null };

        if (!isMounted) return;
        if (eventsError) {
          setPageState("error");
          setLoadError("Não foi possível carregar os eventos da banda. Tente novamente.");
          return;
        }

        setSupportsEvents(hasEventSupport);
        setBandName(band.name);
        setIsAdmin(membership.role === "admin");
        setCurrentUserId(user.id);
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
    if (!canEditTask(access, task) || isSubmitting || deletingTaskId) return;
    setEditingTaskId(task.id);
    setTitle(task.title);
    setDescription(task.description ?? "");
    setStatus(task.status);
    setPriority(task.priority);
    setDueDate(task.due_date ? calendarDay(task.due_date) : "");
    setAssignedTo(task.assigned_to ?? "");
    setRelatedEventId(task.event_id ?? "");
    setFormError("");
    setFormSuccess("");
    setIsFormOpen(true);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function handleCreateTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSubmitting || deletingTaskId) return;

    setFormError("");
    setFormSuccess("");
    const normalizedTitle = title.trim();
    const titleError = requiredTextError(normalizedTitle, "o título da tarefa");
    if (titleError) {
      setFormError(titleError);
      return;
    }
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
        .select("role")
        .eq("band_id", bandId)
        .eq("user_id", user.id)
        .maybeSingle();

      if (membershipError || !membership) {
        setFormError("Você não tem mais acesso a esta banda.");
        return;
      }

      const freshAccess = getBandAccess(user.id, membership.role);
      if (!freshAccess) {
        setFormError("Você não tem permissão para salvar tarefas nesta banda.");
        return;
      }
      if (editingTaskId) {
        const { data: currentTask, error: currentError } = await supabase
          .from("tasks").select("created_by, assigned_to")
          .eq("id", editingTaskId).eq("band_id", bandId).maybeSingle();
        if (currentError || !currentTask) {
          setFormError(recordWriteError(currentError, "editar esta tarefa"));
          return;
        }
        if (!canSaveTask(freshAccess, currentTask, assignedTo || null)) {
          setFormError("Você não tem permissão para salvar esta tarefa com o responsável selecionado. Recarregue a página para atualizar seu acesso.");
          return;
        }
      }

      if (assignedTo && !members.some((member) => member.userId === assignedTo)) {
        setFormError("Selecione um responsável que faça parte desta banda.");
        return;
      }

      let eventValues: { event_id?: string | null };
      try {
        eventValues = taskEventValues(supportsEvents, relatedEventId);
      } catch (error) {
        setFormError((error as Error).message);
        return;
      }

      if (relatedEventId && !events.some((bandEvent) => bandEvent.id === relatedEventId)) {
        setFormError("Selecione um evento que pertença a esta banda.");
        return;
      }

      if (editingTaskId && !editingTask) {
        setFormError("Não foi possível recuperar o prazo original. Recarregue a página.");
        return;
      }
      let deadlineValues: { due_date?: string | null };
      try {
        deadlineValues = taskDeadlinePatch(dueDate, editingTaskId ? editingTask?.due_date : undefined);
      } catch {
        setFormError("Informe um prazo válido.");
        return;
      }

      const taskValues = {
        title: normalizedTitle,
        description: description.trim() || null,
        status,
        priority,
        ...deadlineValues,
        assigned_to: assignedTo || null,
        ...eventValues,
      };

      if (editingTaskId) {
        const { data: updatedTask, error } = await supabase
          .from("tasks")
          .update({ ...taskValues, updated_at: new Date().toISOString() })
          .eq("id", editingTaskId)
          .eq("band_id", bandId)
          .select(taskColumns(supportsEvents))
          .maybeSingle();

        if (error || !updatedTask) {
          setFormError(recordWriteError(error, "salvar esta tarefa"));
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
        .select(taskColumns(supportsEvents))
        .single();

      if (error || !createdTask) {
          setFormError(recordWriteError(error, "salvar esta tarefa"));
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
    if (isSubmitting || deletingTaskId || !window.confirm(`Excluir a tarefa "${task.title}"? Esta ação não pode ser desfeita.`)) return;

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
        setDeleteError(recordWriteError(deleteTaskError, "excluir esta tarefa"));
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
          <Link href={`/bandas/${bandId}`} className="inline-flex min-h-11 items-center rounded-xl border border-accent-border px-4 py-2.5 text-sm font-semibold text-brand transition hover:bg-accent-soft focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-focus">
            ← Voltar para a banda
          </Link>
          <div className="mt-6 rounded-3xl border border-nav-border bg-surface p-8 text-center shadow-app-dashboard sm:p-10">
            {pageState === "loading" ? (
              <p className="text-content-muted">Carregando tarefas...</p>
            ) : pageState === "unauthenticated" ? (
              <>
                <h1 className="text-2xl font-semibold text-content">Entre para continuar</h1>
                <p className="mt-3 text-sm text-content-muted">Faça login para acessar as tarefas da banda.</p>
                <Link href="/login" className="mt-6 inline-flex min-h-11 items-center rounded-xl bg-primary px-5 py-3 text-sm font-semibold text-on-primary transition hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-focus">
                  Ir para o login
                </Link>
              </>
            ) : pageState === "unavailable" ? (
              <>
                <h1 className="text-2xl font-semibold text-content">Banda não encontrada</h1>
                <p className="mt-3 text-sm text-content-muted">Essa banda não existe ou você não tem acesso a ela.</p>
              </>
            ) : (
              <p role="alert" className="text-sm text-danger">{loadError}</p>
            )}
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="flex flex-1 justify-center px-4 py-6 sm:px-6 sm:py-10">
      <div className="w-full max-w-5xl min-w-0">
        <BandWorkspaceInfo name={bandName} role={isAdmin ? "admin" : "member"} />
        <div className="md:hidden"><BandNavigation bandId={bandId} activeSection="tarefas" /></div>

        <header className="mt-7 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0">
            <p className="text-xs font-semibold tracking-[0.16em] text-accent uppercase">{bandName}</p>
            <h1 className="mt-2 break-words text-3xl font-semibold tracking-tight text-content sm:text-4xl">Tarefas</h1>
            <p className="mt-2 text-sm leading-6 text-content-muted">Organize o que precisa ser feito pela banda.</p>
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
            className="inline-flex min-h-11 w-full shrink-0 items-center justify-center rounded-xl bg-primary px-5 py-3 text-sm font-semibold text-on-primary shadow-lg shadow-primary/15 transition hover:bg-primary-hover focus:outline-none focus:ring-4 focus:ring-focus sm:w-auto"
          >
            {isFormOpen ? "Fechar formulário" : "+ Nova tarefa"}
          </button>
        </header>

        {isFormOpen && (
          <section className="mt-6 rounded-2xl border border-nav-border bg-surface p-5 shadow-app-form sm:p-7">
            <div className="mb-5">
              <h2 className="text-lg font-semibold text-content">{editingTaskId ? "Editar tarefa" : "Nova tarefa"}</h2>
              <p className="mt-1 text-sm text-content-subtle">Os campos com * são obrigatórios.</p>
            </div>
            <form onSubmit={handleCreateTask} className="space-y-5">
              <div>
                <label htmlFor="task-title" className="mb-2 block text-sm font-medium text-content-label">Título *</label>
                <input
                  id="task-title"
                  type="text"
                  required
                  maxLength={200}
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  className="min-h-11 w-full rounded-xl border border-outline bg-surface px-4 py-3 text-base md:text-sm text-content outline-none transition placeholder:text-content-faint focus:border-input-focus focus:ring-4 focus:ring-input-ring"
                  placeholder="Ex.: Definir repertório do próximo ensaio"
                />
              </div>

              <div>
                <label htmlFor="task-description" className="mb-2 block text-sm font-medium text-content-label">Descrição <span className="font-normal text-content-faint">(opcional)</span></label>
                <textarea
                  id="task-description"
                  rows={3}
                  maxLength={2000}
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  className="w-full resize-y rounded-xl border border-outline bg-surface px-4 py-3 text-base md:text-sm text-content outline-none transition placeholder:text-content-faint focus:border-input-focus focus:ring-4 focus:ring-input-ring"
                  placeholder="Adicione detalhes para a banda"
                />
              </div>

              <div>
                <label htmlFor="task-event" className="mb-2 block text-sm font-medium text-content-label">Evento relacionado (opcional)</label>
                <select
                  id="task-event"
                  disabled={!supportsEvents}
                  value={relatedEventId}
                  onChange={(event) => setRelatedEventId(event.target.value)}
                  className="min-h-11 w-full rounded-xl border border-outline bg-surface px-3 py-2.5 text-base md:text-sm text-content outline-none focus:border-input-focus focus:ring-4 focus:ring-input-ring"
                >
                  <option value="">Nenhum evento</option>
                  {events.map((bandEvent) => (
                    <option key={bandEvent.id} value={bandEvent.id}>
                      {bandEvent.title} — {formatEventDate(bandEvent.start_at)} às {formatEventTime(bandEvent.start_at)}
                    </option>
                  ))}
                </select>
                {!supportsEvents && <p role="status" className="mt-2 text-sm text-content-muted">A associação com eventos não está disponível neste ambiente. Você pode gerenciar tarefas sem evento.</p>}
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <div>
                  <label htmlFor="task-status" className="mb-2 block text-sm font-medium text-content-label">Status</label>
                  <select id="task-status" value={status} onChange={(event) => setStatus(event.target.value as TaskStatus)} className="min-h-11 w-full rounded-xl border border-outline bg-surface px-3 py-2.5 text-base md:text-sm text-content outline-none focus:border-input-focus focus:ring-4 focus:ring-input-ring">
                    {statusOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </select>
                </div>
                <div>
                  <label htmlFor="task-priority" className="mb-2 block text-sm font-medium text-content-label">Prioridade</label>
                  <select id="task-priority" value={priority} onChange={(event) => setPriority(event.target.value as TaskPriority)} className="min-h-11 w-full rounded-xl border border-outline bg-surface px-3 py-2.5 text-base md:text-sm text-content outline-none focus:border-input-focus focus:ring-4 focus:ring-input-ring">
                    {priorityOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </select>
                </div>
                <div>
                  <label htmlFor="task-due-date" className="mb-2 block text-sm font-medium text-content-label">Prazo <span className="font-normal text-content-faint">(opcional)</span></label>
                  <input id="task-due-date" type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} className="min-h-11 w-full min-w-0 rounded-xl border border-outline bg-surface px-3 py-2.5 text-base md:text-sm text-content outline-none focus:border-input-focus focus:ring-4 focus:ring-input-ring" />
                </div>
                <div>
                  <label htmlFor="task-assignee" className="mb-2 block text-sm font-medium text-content-label">Responsável <span className="font-normal text-content-faint">(opcional)</span></label>
                  <select id="task-assignee" disabled={!canChangeAssignee || isSubmitting} aria-describedby={!canChangeAssignee ? "task-assignee-help" : undefined} value={assignedTo} onChange={(event) => setAssignedTo(event.target.value)} className="min-h-11 w-full rounded-xl border border-outline bg-surface px-3 py-2.5 text-base md:text-sm text-content outline-none focus:border-input-focus focus:ring-4 focus:ring-input-ring">
                    <option value="">Sem responsável</option>
                    {members.map((member) => <option key={member.userId} value={member.userId}>{member.label}</option>)}
                  </select>
                  {!canChangeAssignee && <p id="task-assignee-help" className="mt-2 text-sm text-content-subtle">Somente o autor ou um administrador pode alterar o responsável.</p>}
                </div>
              </div>

              {formError && <p role="alert" className="rounded-xl border border-danger-border bg-danger-surface px-4 py-3 text-sm text-danger">{formError}</p>}

              <div className="flex flex-col-reverse gap-3 pt-1 sm:flex-row sm:justify-end">
                <button type="button" disabled={isSubmitting} onClick={cancelEditing} className="min-h-11 rounded-xl border border-accent-border px-5 py-3 text-sm font-semibold text-brand transition hover:bg-accent-soft focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-focus disabled:opacity-60">
                  {editingTaskId ? "Cancelar edição" : "Cancelar"}
                </button>
                <button type="submit" disabled={isSubmitting} className="min-h-11 rounded-xl bg-primary px-5 py-3 text-sm font-semibold text-on-primary transition hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-focus disabled:cursor-not-allowed disabled:opacity-70">
                  {isSubmitting ? (editingTaskId ? "Salvando alterações..." : "Criando tarefa...") : editingTaskId ? "Salvar alterações" : "Criar tarefa"}
                </button>
              </div>
            </form>
          </section>
        )}

        {formSuccess && <p role="status" className="mt-5 rounded-xl border border-success-border bg-success-surface px-4 py-3 text-sm text-success">{formSuccess}</p>}
        {deleteError && <p role="alert" className="mt-5 rounded-xl border border-danger-border bg-danger-surface px-4 py-3 text-sm text-danger">{deleteError}</p>}

        {tasks.length === 0 ? (
          <section className="mt-6 rounded-2xl border border-dashed border-accent-border bg-surface px-5 py-10 text-center sm:py-14">
            <div aria-hidden="true" className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-accent-soft text-accent">
              <span className="text-xl">✓</span>
            </div>
            <h2 className="mt-4 text-lg font-semibold text-content">Nenhuma tarefa criada ainda.</h2>
            <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-content-muted">Crie uma tarefa para combinar o próximo passo da banda.</p>
            {!isFormOpen && (
              <button type="button" onClick={() => setIsFormOpen(true)} className="mt-5 inline-flex min-h-11 items-center rounded-xl bg-primary px-5 py-3 text-sm font-semibold text-on-primary transition hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-focus">
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
                <article key={task.id} onClick={toggleCardDetails} className="min-w-0 rounded-2xl border border-nav-border bg-surface p-5 shadow-app-card sm:p-6">
                  <div className="flex min-w-0 flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <h2 className="break-words text-base font-semibold text-content sm:text-lg">{task.title}</h2>
                    </div>
                    <div className="flex shrink-0 flex-wrap gap-2 sm:justify-end">
                      <span className={`rounded-full px-3 py-1 text-xs font-semibold ${statusStyles[task.status]}`}>{getStatusLabel(task.status)}</span>
                      <span className={`rounded-full px-3 py-1 text-xs font-semibold ${priorityStyles[task.priority]}`}>{getPriorityLabel(task.priority)}</span>
                    </div>
                  </div>
                  {(task.due_date || assignee) && (
                    <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 pt-3 text-xs text-content-subtle">
                      {task.due_date && <p>Prazo: <span className="font-medium text-content-label">{formatDate(task.due_date)}</span></p>}
                      {assignee && <p>Responsável: <span className="font-medium text-content-label">{assignee}</span></p>}
                    </div>
                  )}
                  {task.event_id && <p className="mt-2 text-xs text-content-subtle">Evento: <span className="font-medium text-content-label">{events.find((bandEvent) => bandEvent.id === task.event_id)?.title ?? "Evento da banda"}</span></p>}
                  <CardDetails title={task.title} description={task.description} />
                  {(canEditTask(access, task) || isAdmin) && <div className="mt-4 flex flex-wrap justify-end gap-2 pt-3">
                    {canEditTask(access, task) && <button
                      type="button"
                      onClick={() => startEditing(task)}
                      disabled={isSubmitting || deletingTaskId !== null}
                      className="inline-flex min-h-10 items-center justify-center rounded-xl border border-accent-border px-4 py-2 text-sm font-semibold text-brand transition hover:bg-accent-soft focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-focus disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      Editar
                    </button>}
                    {isAdmin && (
                      <button
                        type="button"
                        onClick={() => void handleDeleteTask(task)}
                        disabled={isSubmitting || deletingTaskId !== null}
                        className="inline-flex min-h-10 items-center rounded-xl border border-danger-border px-4 py-2 text-sm font-semibold text-danger transition hover:bg-danger-surface focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-focus disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {deletingTaskId === task.id ? "Excluindo..." : "Excluir"}
                      </button>
                    )}
                  </div>}
                </article>
              );
            })}
          </section>
        )}
      </div>
    </main>
  );
}
