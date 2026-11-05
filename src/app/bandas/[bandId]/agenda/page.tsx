"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import BandNavigation from "@/components/band-navigation";
import { BandWorkspaceInfo } from "@/components/band-workspace";
import { useParams } from "next/navigation";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import CardDetails, { toggleCardDetails } from "@/components/card-details";
import { differentLocalEventDays, eventSchedulePatch, toLocalDateTimeInput, validateEventSchedule, watchPageClock } from "@/lib/date-time";
import { requiredTextError } from "@/lib/form-validation";
import { canEditEvent, getBandAccess, recordWriteError } from "@/lib/record-permissions";
import { isMissingTaskEventColumn } from "@/lib/task-event-compatibility";

type EventType =
  | "show"
  | "rehearsal"
  | "recording"
  | "meeting"
  | "interview"
  | "photoshoot"
  | "livestream"
  | "other";

type BandEvent = {
  id: string;
  title: string;
  description: string | null;
  event_type: string;
  start_at: string;
  end_at: string | null;
  location: string | null;
  created_at: string;
  created_by: string;
};

type TaskStatus = "todo" | "in_progress" | "done";
type TaskPriority = "low" | "medium" | "high";

type RelatedTask = {
  id: string;
  event_id: string;
  title: string;
  status: TaskStatus;
  priority: TaskPriority;
};

type PageState = "loading" | "unauthenticated" | "unavailable" | "error" | "ready";

const eventTypes: { value: EventType; label: string }[] = [
  { value: "show", label: "Show" },
  { value: "rehearsal", label: "Ensaio" },
  { value: "recording", label: "Gravação" },
  { value: "meeting", label: "Reunião" },
  { value: "interview", label: "Entrevista" },
  { value: "photoshoot", label: "Fotoshoot" },
  { value: "livestream", label: "Livestream" },
  { value: "other", label: "Outro" },
];

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

function getStatusLabel(status: TaskStatus) {
  return statusOptions.find((option) => option.value === status)?.label ?? status;
}

function getPriorityLabel(priority: TaskPriority) {
  return priorityOptions.find((option) => option.value === priority)?.label ?? priority;
}

function sortEvents(events: BandEvent[], now = Date.now()) {
  return [...events].sort((first, second) => {
    const firstStart = Date.parse(first.start_at);
    const secondStart = Date.parse(second.start_at);
    const firstIsUpcoming = firstStart >= now;
    const secondIsUpcoming = secondStart >= now;

    if (firstIsUpcoming !== secondIsUpcoming) return firstIsUpcoming ? -1 : 1;
    return firstIsUpcoming ? firstStart - secondStart : secondStart - firstStart;
  });
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

function getEventTypeLabel(eventType: string) {
  return eventTypes.find((type) => type.value === eventType)?.label ?? eventType;
}

function getLocalDateTimeMinimum(now: number) {
  const roundedNow = Math.ceil(now / 60_000) * 60_000;
  const localDate = new Date(roundedNow);
  const localValue = new Date(roundedNow - localDate.getTimezoneOffset() * 60_000);
  return localValue.toISOString().slice(0, 16);
}

export default function BandAgendaPage() {
  const { bandId } = useParams<{ bandId: string }>();
  const [pageState, setPageState] = useState<PageState>("loading");
  const [currentTime, setCurrentTime] = useState(0);
  const [bandName, setBandName] = useState("");
  const [isAdmin, setIsAdmin] = useState(false);
  const [events, setEvents] = useState<BandEvent[]>([]);
  const [tasksByEvent, setTasksByEvent] = useState<Record<string, RelatedTask[]>>({});
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingEventId, setEditingEventId] = useState<string | null>(null);
  const [minimumStartAt, setMinimumStartAt] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [formError, setFormError] = useState("");
  const [formSuccess, setFormSuccess] = useState("");
  const [deleteError, setDeleteError] = useState("");
  const [deletingEventId, setDeletingEventId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [eventType, setEventType] = useState<EventType>("show");
  const [customEventType, setCustomEventType] = useState("");
  const [startAt, setStartAt] = useState("");
  const [endAt, setEndAt] = useState("");
  const [location, setLocation] = useState("");
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [supportsRelatedTasks, setSupportsRelatedTasks] = useState(true);
  const access = getBandAccess(currentUserId, isAdmin ? "admin" : "member");
  const originalEvent = events.find((item) => item.id === editingEventId);
  const endAtMinimum = startAt || undefined;

  useEffect(() => watchPageClock(setCurrentTime), []);

  useEffect(() => {
    if (!isFormOpen) return;

    const interval = window.setInterval(() => {
      setMinimumStartAt(getLocalDateTimeMinimum(Date.now()));
    }, 30_000);

    return () => window.clearInterval(interval);
  }, [isFormOpen]);

  useEffect(() => {
    let isMounted = true;

    async function loadAgenda() {
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

        const { data, error } = await supabase
          .from("events")
          .select("id, title, description, event_type, start_at, end_at, location, created_at, created_by")
          .eq("band_id", bandId)
          .order("start_at", { ascending: true });

        if (!isMounted) return;
        if (error) {
          setPageState("error");
          setLoadError("Não foi possível carregar os eventos. Tente novamente.");
          return;
        }

        const loadedEvents = (data ?? []) as unknown as BandEvent[];
        const eventIds = loadedEvents.map((bandEvent) => bandEvent.id);
        let relatedTasks: RelatedTask[] = [];
        let hasRelatedTaskSupport = true;

        if (eventIds.length > 0) {
          const { data: taskRows, error: tasksError } = await supabase
            .from("tasks")
            .select("id, event_id, title, status, priority")
            .eq("band_id", bandId)
            .in("event_id", eventIds);

          if (!isMounted) return;
          if (tasksError && !isMissingTaskEventColumn(tasksError)) {
            setPageState("error");
            setLoadError("Não foi possível carregar as tarefas dos eventos. Tente novamente.");
            return;
          }

          hasRelatedTaskSupport = !isMissingTaskEventColumn(tasksError);
          if (hasRelatedTaskSupport) relatedTasks = (taskRows ?? []) as unknown as RelatedTask[];
        }

        const groupedTasks = relatedTasks.reduce<Record<string, RelatedTask[]>>((groups, task) => {
          if (!task.event_id) return groups;
          groups[task.event_id] = [...(groups[task.event_id] ?? []), task];
          return groups;
        }, {});

        setBandName(band.name);
        setIsAdmin(membership.role === "admin");
        setCurrentUserId(user.id);
        setEvents(sortEvents(loadedEvents));
        setTasksByEvent(groupedTasks);
        setSupportsRelatedTasks(hasRelatedTaskSupport);
        setCurrentTime(Date.now());
        setPageState("ready");
      } catch {
        if (isMounted) {
          setPageState("error");
          setLoadError("Não foi possível carregar a agenda. Tente novamente.");
        }
      }
    }

    void loadAgenda();
    return () => {
      isMounted = false;
    };
  }, [bandId]);

  function resetForm() {
    setEditingEventId(null);
    setTitle("");
    setDescription("");
    setEventType("show");
    setCustomEventType("");
    setStartAt("");
    setEndAt("");
    setLocation("");
    setFormError("");
  }

  function startEditingEvent(bandEvent: BandEvent) {
    if (!canEditEvent(access, bandEvent) || isSubmitting || deletingEventId) return;
    setEditingEventId(bandEvent.id);
    setTitle(bandEvent.title);
    setDescription(bandEvent.description ?? "");
    const isStandardType = eventTypes.some((type) => type.value !== "other" && type.value === bandEvent.event_type);
    setEventType(isStandardType ? bandEvent.event_type as EventType : "other");
    setCustomEventType(isStandardType ? "" : bandEvent.event_type);
    setStartAt(toLocalDateTimeInput(bandEvent.start_at));
    setEndAt(bandEvent.end_at ? toLocalDateTimeInput(bandEvent.end_at) : "");
    setLocation(bandEvent.location ?? "");
    setMinimumStartAt(getLocalDateTimeMinimum(currentTime));
    setFormError("");
    setFormSuccess("");
    setIsFormOpen(true);
  }

  function openForm() {
    setMinimumStartAt(getLocalDateTimeMinimum(Date.now()));
    setFormError("");
    setIsFormOpen(true);
  }

  function toggleForm() {
    if (isSubmitting) return;
    if (isFormOpen) {
      resetForm();
      setIsFormOpen(false);
      return;
    }
    openForm();
  }

  async function handleCreateEvent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSubmitting || deletingEventId) return;

    setFormError("");

    const normalizedTitle = title.trim();
    const titleError = requiredTextError(normalizedTitle, "o título do evento");
    if (titleError) {
      setFormError(titleError);
      return;
    }

    const normalizedEventType = eventType === "other" ? customEventType.trim() : eventType;
    if (!normalizedEventType) {
      setFormError("Informe o nome do tipo de evento.");
      return;
    }

    const submittedStartAt = startAt;
    const submittedEndAt = endAt;
    if (editingEventId && !originalEvent) {
      setFormError("Não foi possível recuperar as datas originais. Recarregue a página.");
      return;
    }
    const scheduleError = validateEventSchedule(submittedStartAt, submittedEndAt, Date.now(), originalEvent);
    if (scheduleError) {
      setFormError(scheduleError);
      return;
    }

    setIsSubmitting(true);
    try {
      const supabase = getSupabaseBrowserClient();
      const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
      const user = sessionData.session?.user;

      if (sessionError || !user) {
        setFormError(`Sua sessão expirou. Entre novamente para ${editingEventId ? "editar" : "criar"} um evento.`);
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
        setFormError("Você não tem permissão para salvar eventos nesta banda.");
        return;
      }
      let currentSchedule = originalEvent;
      if (editingEventId) {
        const { data: currentEvent, error: currentError } = await supabase
          .from("events").select("created_by, start_at, end_at")
          .eq("id", editingEventId).eq("band_id", bandId).maybeSingle();
        if (currentError || !currentEvent) {
          setFormError(recordWriteError(currentError, "editar este evento"));
          return;
        }
        currentSchedule = { ...originalEvent!, ...currentEvent };
        if (!canEditEvent(freshAccess, currentEvent)) {
          setFormError("Você não tem permissão para editar este evento. Recarregue a página para atualizar seu acesso.");
          return;
        }
      }

      const finalScheduleError = validateEventSchedule(submittedStartAt, submittedEndAt, Date.now(), originalEvent, currentSchedule);
      if (finalScheduleError) {
        setFormError(finalScheduleError);
        return;
      }

      const scheduleValues = eventSchedulePatch(submittedStartAt, submittedEndAt, originalEvent);

      const eventValues = {
        title: normalizedTitle,
        description: description.trim() || null,
        event_type: normalizedEventType,
        ...scheduleValues,
        location: location.trim() || null,
      };

      const result = editingEventId
        ? await supabase.from("events").update({ ...eventValues, updated_at: new Date().toISOString() }).eq("id", editingEventId).eq("band_id", bandId).select("id, title, description, event_type, start_at, end_at, location, created_at, created_by").maybeSingle()
        : await supabase.from("events").insert({ ...eventValues, band_id: bandId, created_by: user.id }).select("id, title, description, event_type, start_at, end_at, location, created_at, created_by").single();
      const savedEvent = result.data;
      const error = result.error;

      if (error || !savedEvent) {
        setFormError(recordWriteError(error, editingEventId ? "editar este evento" : "criar o evento"));
        return;
      }

      const savedBandEvent = savedEvent as unknown as BandEvent;
      setEvents((currentEvents) => sortEvents(editingEventId
        ? currentEvents.map((currentEvent) => currentEvent.id === editingEventId ? savedBandEvent : currentEvent)
        : [...currentEvents, savedBandEvent]));
      setCurrentTime(Date.now());
      setFormSuccess(editingEventId ? "Evento atualizado com sucesso." : "Evento criado com sucesso.");
      resetForm();
      setIsFormOpen(false);
    } catch {
      setFormError(editingEventId ? "Não foi possível atualizar o evento agora. Tente novamente." : "Não foi possível criar o evento agora. Tente novamente.");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleDeleteEvent(bandEvent: BandEvent) {
    if (isSubmitting || deletingEventId || !window.confirm(`Excluir o evento "${bandEvent.title}"? Esta ação não pode ser desfeita.`)) return;

    setDeleteError("");
    setDeletingEventId(bandEvent.id);

    try {
      const supabase = getSupabaseBrowserClient();
      const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
      const user = sessionData.session?.user;

      if (sessionError || !user) {
        setDeleteError("Sua sessão expirou. Entre novamente para excluir um evento.");
        return;
      }

      const { data: membership, error: membershipError } = await supabase
        .from("band_members")
        .select("role")
        .eq("band_id", bandId)
        .eq("user_id", user.id)
        .maybeSingle();

      if (membershipError || membership?.role !== "admin") {
        setDeleteError("Somente administradores da banda podem excluir eventos.");
        return;
      }

      const { data: deletedEvent, error: deleteEventError } = await supabase
        .from("events")
        .delete()
        .eq("id", bandEvent.id)
        .eq("band_id", bandId)
        .select("id")
        .maybeSingle();

      if (deleteEventError || !deletedEvent) {
        setDeleteError(recordWriteError(deleteEventError, "excluir este evento"));
        return;
      }

      setEvents((currentEvents) => currentEvents.filter((event) => event.id !== bandEvent.id));
    } catch {
      setDeleteError("Não foi possível excluir o evento agora. Tente novamente.");
    } finally {
      setDeletingEventId(null);
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
              <p className="text-content-muted">Carregando agenda...</p>
            ) : pageState === "unauthenticated" ? (
              <>
                <h1 className="text-2xl font-semibold text-content">Entre para continuar</h1>
                <p className="mt-3 text-sm text-content-muted">Faça login para acessar a agenda da banda.</p>
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
        <div className="md:hidden"><BandNavigation bandId={bandId} activeSection="agenda" /></div>

        <header className="mt-7 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0">
            <p className="break-words text-xs font-semibold tracking-[0.16em] text-accent uppercase">{bandName}</p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight text-content sm:text-4xl">Agenda</h1>
            <p className="mt-2 text-sm leading-6 text-content-muted">Shows, ensaios e outros compromissos da banda.</p>
          </div>
          <button
            type="button"
            onClick={toggleForm}
            disabled={isSubmitting}
            className="inline-flex min-h-11 w-full shrink-0 items-center justify-center rounded-xl bg-primary px-5 py-3 text-sm font-semibold text-on-primary shadow-lg shadow-primary/15 transition hover:bg-primary-hover focus:outline-none focus:ring-4 focus:ring-focus sm:w-auto"
          >
            {isFormOpen ? "Fechar formulário" : "+ Novo evento"}
          </button>
        </header>

        {formSuccess && <p role="status" className="mt-5 rounded-xl border border-success-border bg-success-surface px-4 py-3 text-sm text-success">{formSuccess}</p>}

        {isFormOpen && (
          <section className="mt-6 rounded-2xl border border-nav-border bg-surface p-5 shadow-app-form sm:p-7">
            <div className="mb-5">
              <h2 className="text-lg font-semibold text-content">{editingEventId ? "Editar evento" : "Novo evento"}</h2>
              <p className="mt-1 text-sm text-content-subtle">{editingEventId ? "Atualize os detalhes deste evento." : "Informe os detalhes para adicionar à agenda da banda."}</p>
            </div>
            <form onSubmit={handleCreateEvent} className="space-y-5">
              <div>
                <label htmlFor="event-title" className="mb-2 block text-sm font-medium text-content-label">Título *</label>
                <input id="event-title" type="text" required maxLength={200} value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Ex.: Ensaio no estúdio" className="min-h-11 w-full rounded-xl border border-outline bg-surface px-4 py-3 text-base md:text-sm text-content outline-none transition placeholder:text-content-faint focus:border-input-focus focus:ring-4 focus:ring-input-ring" />
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label htmlFor="event-type" className="mb-2 block text-sm font-medium text-content-label">Tipo *</label>
                  <select id="event-type" required value={eventType} onChange={(event) => {
                    const selectedEventType = event.target.value as EventType;
                    setEventType(selectedEventType);
                    if (selectedEventType !== "other") setCustomEventType("");
                  }} className="min-h-11 w-full rounded-xl border border-outline bg-surface px-3 py-2.5 text-base md:text-sm text-content outline-none focus:border-input-focus focus:ring-4 focus:ring-input-ring">
                    {eventTypes.map((type) => <option key={type.value} value={type.value}>{type.label}</option>)}
                  </select>
                </div>
                {eventType === "other" && (
                  <div>
                    <label htmlFor="event-custom-type" className="mb-2 block text-sm font-medium text-content-label">Nome do tipo *</label>
                    <input
                      id="event-custom-type"
                      type="text"
                      required
                      maxLength={100}
                      value={customEventType}
                      onChange={(event) => setCustomEventType(event.target.value)}
                      disabled={isSubmitting}
                      placeholder="Ex.: Podcast"
                      className="min-h-11 w-full rounded-xl border border-outline bg-surface px-4 py-3 text-base md:text-sm text-content outline-none transition placeholder:text-content-faint focus:border-input-focus focus:ring-4 focus:ring-input-ring"
                    />
                  </div>
                )}
                <div>
                  <label htmlFor="event-location" className="mb-2 block text-sm font-medium text-content-label">Local <span className="font-normal text-content-faint">(opcional)</span></label>
                  <input id="event-location" type="text" maxLength={300} value={location} onChange={(event) => setLocation(event.target.value)} placeholder="Ex.: Estúdio central" className="min-h-11 w-full rounded-xl border border-outline bg-surface px-4 py-3 text-base md:text-sm text-content outline-none transition placeholder:text-content-faint focus:border-input-focus focus:ring-4 focus:ring-input-ring" />
                </div>
                <div>
                  <label htmlFor="event-start" className="mb-2 block text-sm font-medium text-content-label">Início *</label>
                  <input id="event-start" type="datetime-local" required min={editingEventId ? undefined : minimumStartAt || undefined} value={startAt} disabled={isSubmitting} onChange={(event) => setStartAt(event.target.value)} className="min-h-11 w-full min-w-0 rounded-xl border border-outline bg-surface px-3 py-2.5 text-base md:text-sm text-content outline-none focus:border-input-focus focus:ring-4 focus:ring-input-ring" />
                </div>
                <div>
                  <label htmlFor="event-end" className="mb-2 block text-sm font-medium text-content-label">Término <span className="font-normal text-content-faint">(opcional)</span></label>
                  <input id="event-end" type="datetime-local" min={endAtMinimum} value={endAt} disabled={isSubmitting} onChange={(event) => setEndAt(event.target.value)} className="min-h-11 w-full min-w-0 rounded-xl border border-outline bg-surface px-3 py-2.5 text-base md:text-sm text-content outline-none focus:border-input-focus focus:ring-4 focus:ring-input-ring" />
                </div>
              </div>

              <div>
                <label htmlFor="event-description" className="mb-2 block text-sm font-medium text-content-label">Descrição <span className="font-normal text-content-faint">(opcional)</span></label>
                <textarea id="event-description" rows={3} maxLength={2000} value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Adicione informações úteis para os integrantes" className="w-full resize-y rounded-xl border border-outline bg-surface px-4 py-3 text-base md:text-sm text-content outline-none transition placeholder:text-content-faint focus:border-input-focus focus:ring-4 focus:ring-input-ring" />
              </div>

              {formError && <p role="alert" className="rounded-xl border border-danger-border bg-danger-surface px-4 py-3 text-sm text-danger">{formError}</p>}

              <div className="flex flex-col-reverse gap-3 pt-1 sm:flex-row sm:justify-end">
                <button type="button" disabled={isSubmitting} onClick={() => { resetForm(); setFormSuccess(""); setIsFormOpen(false); }} className="min-h-11 rounded-xl border border-accent-border px-5 py-3 text-sm font-semibold text-brand transition hover:bg-accent-soft focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-focus disabled:opacity-60">
                  {editingEventId ? "Cancelar edição" : "Cancelar"}
                </button>
                <button type="submit" disabled={isSubmitting} className="min-h-11 rounded-xl bg-primary px-5 py-3 text-sm font-semibold text-on-primary transition hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-focus disabled:cursor-not-allowed disabled:opacity-70">
                  {isSubmitting ? (editingEventId ? "Salvando alterações..." : "Salvando evento...") : (editingEventId ? "Salvar alterações" : "Criar evento")}
                </button>
              </div>
            </form>
          </section>
        )}

        {deleteError && <p role="alert" className="mt-5 rounded-xl border border-danger-border bg-danger-surface px-4 py-3 text-sm text-danger">{deleteError}</p>}

        {events.length === 0 ? (
          <section className="mt-6 rounded-2xl border border-dashed border-accent-border bg-surface px-5 py-10 text-center sm:py-14">
            <div aria-hidden="true" className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-accent-soft text-accent">
              <span className="text-lg">♪</span>
            </div>
            <h2 className="mt-4 text-lg font-semibold text-content">Nenhum evento cadastrado ainda.</h2>
            <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-content-muted">Adicione um show, ensaio ou compromisso para a banda.</p>
            {!isFormOpen && (
              <button type="button" onClick={openForm} className="mt-5 inline-flex min-h-11 items-center rounded-xl bg-primary px-5 py-3 text-sm font-semibold text-on-primary transition hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-focus">
                Adicionar primeiro evento
              </button>
            )}
          </section>
        ) : (
          <section aria-label="Lista de eventos" className="mt-6 space-y-3">
            {!supportsRelatedTasks && <p role="status" className="text-sm text-content-muted">Tarefas associadas indisponíveis neste ambiente. Os eventos continuam disponíveis na agenda.</p>}
            {sortEvents(events, currentTime).map((bandEvent) => {
              const isUpcoming = Date.parse(bandEvent.start_at) >= currentTime;

              return (
                <article key={bandEvent.id} onClick={toggleCardDetails} className={`min-w-0 rounded-2xl border bg-surface p-5 shadow-app-card sm:p-6 ${isUpcoming ? "border-accent-border ring-1 ring-input-ring" : "border-outline"}`}>
                  <div className="flex min-w-0 flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="break-words text-base font-semibold text-content sm:text-lg">{bandEvent.title}</h2>
                        {isUpcoming && <span className="rounded-full bg-accent-soft px-2.5 py-1 text-[11px] font-semibold text-accent">Próximo</span>}
                      </div>
                      <p className="mt-2 text-xs font-semibold tracking-wide text-accent uppercase">{getEventTypeLabel(bandEvent.event_type)}</p>
                    </div>
                    <div className={`w-full shrink-0 rounded-xl px-4 py-3 sm:w-auto sm:min-w-44 ${isUpcoming ? "bg-accent-soft" : "bg-surface-muted"}`}>
                      <p className="text-sm font-semibold text-content">{formatEventDate(bandEvent.start_at)}</p>
                      <p className="mt-1 text-sm tabular-nums text-content-muted">
                        {formatEventTime(bandEvent.start_at)}
                        {bandEvent.end_at && <> – {differentLocalEventDays(bandEvent.start_at, bandEvent.end_at) && <>{formatEventDate(bandEvent.end_at)} às </>}{formatEventTime(bandEvent.end_at)}</>}
                      </p>
                    </div>
                  </div>
                  {bandEvent.location?.trim() && (
                    <p className="mt-4 pt-3 text-sm text-content-muted">
                      <span className="font-medium text-content-strong">Local:</span> {bandEvent.location}
                    </p>
                  )}
                  <CardDetails title={bandEvent.title} description={bandEvent.description}>
                  {(tasksByEvent[bandEvent.id]?.length ?? 0) > 0 && (
                    <div className="mt-4 pt-4">
                      <h3 className="text-sm font-semibold text-content-strong">Tarefas relacionadas</h3>
                      <ul className="mt-3 space-y-2">
                        {tasksByEvent[bandEvent.id].map((task) => (
                          <li key={task.id} className="flex min-w-0 flex-col gap-2 rounded-xl bg-surface-muted px-3 py-3 sm:flex-row sm:items-center sm:justify-between">
                            <span className="break-words text-sm font-medium text-content-strong">{task.title}</span>
                            <span className="flex flex-wrap gap-2">
                              <span className="rounded-full bg-accent-soft px-2.5 py-1 text-xs font-semibold text-accent">{getStatusLabel(task.status)}</span>
                              <span className="rounded-full bg-outline px-2.5 py-1 text-xs font-semibold text-content-label">Prioridade: {getPriorityLabel(task.priority)}</span>
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  </CardDetails>
                  {(canEditEvent(access, bandEvent) || isAdmin) && <div className="mt-4 flex flex-wrap justify-end gap-2 pt-3">
                    {canEditEvent(access, bandEvent) && <button
                      type="button"
                      onClick={() => startEditingEvent(bandEvent)}
                      disabled={isSubmitting || deletingEventId !== null}
                      className="inline-flex min-h-10 items-center rounded-xl border border-accent-border px-4 py-2 text-sm font-semibold text-brand transition hover:bg-accent-soft focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-focus disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      Editar
                    </button>}
                    {isAdmin && (
                      <div>
                      <button
                        type="button"
                        onClick={() => void handleDeleteEvent(bandEvent)}
                        disabled={isSubmitting || deletingEventId !== null}
                        className="inline-flex min-h-10 items-center rounded-xl border border-danger-border px-4 py-2 text-sm font-semibold text-danger transition hover:bg-danger-surface focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-focus disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {deletingEventId === bandEvent.id ? "Excluindo..." : "Excluir"}
                      </button>
                      </div>
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
