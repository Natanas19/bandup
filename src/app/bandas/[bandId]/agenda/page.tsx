"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import BandNavigation from "@/components/band-navigation";
import { useParams } from "next/navigation";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { LinkifiedText } from "@/components/linkified-text";

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

function toLocalDateTimeInput(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

function parseLocalDateTime(value: string) {
  const [datePart, timePart] = value.split("T");
  if (!datePart || !timePart) return new Date(Number.NaN);

  const [year, month, day] = datePart.split("-").map(Number);
  const [hour, minute] = timePart.split(":").map(Number);
  if ([year, month, day, hour, minute].some(Number.isNaN)) return new Date(Number.NaN);

  const localDate = new Date(year, month - 1, day, hour, minute);
  if (
    localDate.getFullYear() !== year ||
    localDate.getMonth() !== month - 1 ||
    localDate.getDate() !== day ||
    localDate.getHours() !== hour ||
    localDate.getMinutes() !== minute
  ) {
    return new Date(Number.NaN);
  }

  return localDate;
}

function validateEventSchedule(startValue: string, endValue: string, now: number) {
  const startDate = parseLocalDateTime(startValue);
  const endDate = endValue ? parseLocalDateTime(endValue) : null;

  if (!startValue || Number.isNaN(startDate.getTime()) || (endDate && Number.isNaN(endDate.getTime()))) {
    return "Informe uma data e horário válidos.";
  }
  if (startDate.getTime() < now) {
    return "O início do evento não pode estar no passado.";
  }
  if (endDate && endDate < startDate) {
    return "O término não pode ser anterior ao início.";
  }

  return null;
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
  const endAtMinimum = startAt || undefined;

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
          .select("id, title, description, event_type, start_at, end_at, location, created_at")
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

        if (eventIds.length > 0) {
          const { data: taskRows, error: tasksError } = await supabase
            .from("tasks")
            .select("id, event_id, title, status, priority")
            .eq("band_id", bandId)
            .in("event_id", eventIds);

          if (!isMounted) return;
          if (tasksError) {
            setPageState("error");
            setLoadError("Não foi possível carregar as tarefas dos eventos. Tente novamente.");
            return;
          }

          relatedTasks = (taskRows ?? []) as unknown as RelatedTask[];
        }

        const groupedTasks = relatedTasks.reduce<Record<string, RelatedTask[]>>((groups, task) => {
          if (!task.event_id) return groups;
          groups[task.event_id] = [...(groups[task.event_id] ?? []), task];
          return groups;
        }, {});

        setBandName(band.name);
        setIsAdmin(membership.role === "admin");
        setEvents(sortEvents(loadedEvents));
        setTasksByEvent(groupedTasks);
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
    if (isSubmitting) return;

    setFormError("");

    const normalizedEventType = eventType === "other" ? customEventType.trim() : eventType;
    if (!normalizedEventType) {
      setFormError("Informe o nome do tipo de evento.");
      return;
    }

    const submittedStartAt = startAt;
    const submittedEndAt = endAt;
    const scheduleError = validateEventSchedule(submittedStartAt, submittedEndAt, Date.now());
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
        .select("user_id")
        .eq("band_id", bandId)
        .eq("user_id", user.id)
        .maybeSingle();

      if (membershipError || !membership) {
        setFormError("Você não tem mais acesso a esta banda.");
        return;
      }

      const finalScheduleError = validateEventSchedule(submittedStartAt, submittedEndAt, Date.now());
      if (finalScheduleError) {
        setFormError(finalScheduleError);
        return;
      }

      const startDate = parseLocalDateTime(submittedStartAt);
      const endDate = submittedEndAt ? parseLocalDateTime(submittedEndAt) : null;

      const eventValues = {
        title: title.trim(),
        description: description.trim() || null,
        event_type: normalizedEventType,
        start_at: startDate.toISOString(),
        end_at: endDate ? endDate.toISOString() : null,
        location: location.trim() || null,
      };

      const result = editingEventId
        ? await supabase.from("events").update({ ...eventValues, updated_at: new Date().toISOString() }).eq("id", editingEventId).eq("band_id", bandId).select("id, title, description, event_type, start_at, end_at, location, created_at").maybeSingle()
        : await supabase.from("events").insert({ ...eventValues, band_id: bandId, created_by: user.id }).select("id, title, description, event_type, start_at, end_at, location, created_at").single();
      const savedEvent = result.data;
      const error = result.error;

      if (error || !savedEvent) {
        setFormError(editingEventId ? "Não foi possível salvar as alterações. Confira os dados e tente novamente." : "Não foi possível criar o evento. Confira os dados e tente novamente.");
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
    if (deletingEventId || !window.confirm(`Excluir o evento "${bandEvent.title}"? Esta ação não pode ser desfeita.`)) return;

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
        setDeleteError("Não foi possível excluir o evento. Tente novamente.");
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
          <Link href={`/bandas/${bandId}`} className="inline-flex min-h-11 items-center rounded-xl border border-violet-200 px-4 py-2.5 text-sm font-semibold text-violet-800 transition hover:bg-violet-50">
            ← Voltar para a banda
          </Link>
          <div className="mt-6 rounded-3xl border border-violet-100 bg-white p-8 text-center shadow-[0_20px_60px_-32px_rgba(54,36,104,0.28)] sm:p-10">
            {pageState === "loading" ? (
              <p className="text-zinc-600">Carregando agenda...</p>
            ) : pageState === "unauthenticated" ? (
              <>
                <h1 className="text-2xl font-semibold text-zinc-900">Entre para continuar</h1>
                <p className="mt-3 text-sm text-zinc-600">Faça login para acessar a agenda da banda.</p>
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
        <BandNavigation bandId={bandId} activeSection="agenda" />

        <header className="mt-7 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0">
            <p className="break-words text-xs font-semibold tracking-[0.16em] text-violet-700 uppercase">{bandName}</p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight text-zinc-900 sm:text-4xl">Agenda</h1>
            <p className="mt-2 text-sm leading-6 text-zinc-600">Shows, ensaios e outros compromissos da banda.</p>
          </div>
          <button
            type="button"
            onClick={toggleForm}
            disabled={isSubmitting}
            className="inline-flex min-h-11 w-full shrink-0 items-center justify-center rounded-xl bg-violet-700 px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-violet-700/15 transition hover:bg-violet-800 focus:outline-none focus:ring-4 focus:ring-violet-200 sm:w-auto"
          >
            {isFormOpen ? "Fechar formulário" : "+ Novo evento"}
          </button>
        </header>

        {formSuccess && <p role="status" className="mt-5 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{formSuccess}</p>}

        {isFormOpen && (
          <section className="mt-6 rounded-2xl border border-violet-100 bg-white p-5 shadow-[0_16px_48px_-32px_rgba(54,36,104,0.35)] sm:p-7">
            <div className="mb-5">
              <h2 className="text-lg font-semibold text-zinc-900">{editingEventId ? "Editar evento" : "Novo evento"}</h2>
              <p className="mt-1 text-sm text-zinc-500">{editingEventId ? "Atualize os detalhes deste evento." : "Informe os detalhes para adicionar à agenda da banda."}</p>
            </div>
            <form onSubmit={handleCreateEvent} className="space-y-5">
              <div>
                <label htmlFor="event-title" className="mb-2 block text-sm font-medium text-zinc-700">Título *</label>
                <input id="event-title" type="text" required maxLength={200} value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Ex.: Ensaio no estúdio" className="min-h-11 w-full rounded-xl border border-zinc-200 px-4 py-3 text-base md:text-sm text-zinc-900 outline-none transition placeholder:text-zinc-400 focus:border-violet-500 focus:ring-4 focus:ring-violet-100" />
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label htmlFor="event-type" className="mb-2 block text-sm font-medium text-zinc-700">Tipo *</label>
                  <select id="event-type" required value={eventType} onChange={(event) => {
                    const selectedEventType = event.target.value as EventType;
                    setEventType(selectedEventType);
                    if (selectedEventType !== "other") setCustomEventType("");
                  }} className="min-h-11 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2.5 text-base md:text-sm text-zinc-900 outline-none focus:border-violet-500 focus:ring-4 focus:ring-violet-100">
                    {eventTypes.map((type) => <option key={type.value} value={type.value}>{type.label}</option>)}
                  </select>
                </div>
                {eventType === "other" && (
                  <div>
                    <label htmlFor="event-custom-type" className="mb-2 block text-sm font-medium text-zinc-700">Nome do tipo *</label>
                    <input
                      id="event-custom-type"
                      type="text"
                      required
                      maxLength={100}
                      value={customEventType}
                      onChange={(event) => setCustomEventType(event.target.value)}
                      disabled={isSubmitting}
                      placeholder="Ex.: Podcast"
                      className="min-h-11 w-full rounded-xl border border-zinc-200 px-4 py-3 text-base md:text-sm text-zinc-900 outline-none transition placeholder:text-zinc-400 focus:border-violet-500 focus:ring-4 focus:ring-violet-100"
                    />
                  </div>
                )}
                <div>
                  <label htmlFor="event-location" className="mb-2 block text-sm font-medium text-zinc-700">Local <span className="font-normal text-zinc-400">(opcional)</span></label>
                  <input id="event-location" type="text" maxLength={300} value={location} onChange={(event) => setLocation(event.target.value)} placeholder="Ex.: Estúdio central" className="min-h-11 w-full rounded-xl border border-zinc-200 px-4 py-3 text-base md:text-sm text-zinc-900 outline-none transition placeholder:text-zinc-400 focus:border-violet-500 focus:ring-4 focus:ring-violet-100" />
                </div>
                <div>
                  <label htmlFor="event-start" className="mb-2 block text-sm font-medium text-zinc-700">Início *</label>
                  <input id="event-start" type="datetime-local" required min={minimumStartAt || undefined} value={startAt} disabled={isSubmitting} onChange={(event) => setStartAt(event.target.value)} className="min-h-11 w-full min-w-0 rounded-xl border border-zinc-200 bg-white px-3 py-2.5 text-base md:text-sm text-zinc-900 outline-none focus:border-violet-500 focus:ring-4 focus:ring-violet-100" />
                </div>
                <div>
                  <label htmlFor="event-end" className="mb-2 block text-sm font-medium text-zinc-700">Término <span className="font-normal text-zinc-400">(opcional)</span></label>
                  <input id="event-end" type="datetime-local" min={endAtMinimum} value={endAt} disabled={isSubmitting} onChange={(event) => setEndAt(event.target.value)} className="min-h-11 w-full min-w-0 rounded-xl border border-zinc-200 bg-white px-3 py-2.5 text-base md:text-sm text-zinc-900 outline-none focus:border-violet-500 focus:ring-4 focus:ring-violet-100" />
                </div>
              </div>

              <div>
                <label htmlFor="event-description" className="mb-2 block text-sm font-medium text-zinc-700">Descrição <span className="font-normal text-zinc-400">(opcional)</span></label>
                <textarea id="event-description" rows={3} maxLength={2000} value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Adicione informações úteis para os integrantes" className="w-full resize-y rounded-xl border border-zinc-200 px-4 py-3 text-base md:text-sm text-zinc-900 outline-none transition placeholder:text-zinc-400 focus:border-violet-500 focus:ring-4 focus:ring-violet-100" />
              </div>

              {formError && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{formError}</p>}

              <div className="flex flex-col-reverse gap-3 pt-1 sm:flex-row sm:justify-end">
                <button type="button" disabled={isSubmitting} onClick={() => { resetForm(); setFormSuccess(""); setIsFormOpen(false); }} className="min-h-11 rounded-xl border border-violet-200 px-5 py-3 text-sm font-semibold text-violet-800 transition hover:bg-violet-50 disabled:opacity-60">
                  {editingEventId ? "Cancelar edição" : "Cancelar"}
                </button>
                <button type="submit" disabled={isSubmitting} className="min-h-11 rounded-xl bg-violet-700 px-5 py-3 text-sm font-semibold text-white transition hover:bg-violet-800 disabled:cursor-not-allowed disabled:opacity-70">
                  {isSubmitting ? (editingEventId ? "Salvando alterações..." : "Salvando evento...") : (editingEventId ? "Salvar alterações" : "Criar evento")}
                </button>
              </div>
            </form>
          </section>
        )}

        {deleteError && <p role="alert" className="mt-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{deleteError}</p>}

        {events.length === 0 ? (
          <section className="mt-6 rounded-2xl border border-dashed border-violet-200 bg-white px-5 py-10 text-center sm:py-14">
            <div aria-hidden="true" className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-violet-50 text-violet-700">
              <span className="text-lg">♪</span>
            </div>
            <h2 className="mt-4 text-lg font-semibold text-zinc-900">Nenhum evento cadastrado ainda.</h2>
            <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-zinc-600">Adicione um show, ensaio ou compromisso para a banda.</p>
            {!isFormOpen && (
              <button type="button" onClick={openForm} className="mt-5 inline-flex min-h-11 items-center rounded-xl bg-violet-700 px-5 py-3 text-sm font-semibold text-white transition hover:bg-violet-800">
                Adicionar primeiro evento
              </button>
            )}
          </section>
        ) : (
          <section aria-label="Lista de eventos" className="mt-6 space-y-3">
            {events.map((bandEvent) => {
              const isUpcoming = Date.parse(bandEvent.start_at) >= currentTime;

              return (
                <article key={bandEvent.id} className={`min-w-0 rounded-2xl border bg-white p-5 shadow-[0_12px_36px_-28px_rgba(54,36,104,0.35)] sm:p-6 ${isUpcoming ? "border-violet-200 ring-1 ring-violet-100" : "border-zinc-200"}`}>
                  <div className="flex min-w-0 flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="break-words text-base font-semibold text-zinc-900 sm:text-lg">{bandEvent.title}</h2>
                        {isUpcoming && <span className="rounded-full bg-violet-50 px-2.5 py-1 text-[11px] font-semibold text-violet-700">Próximo</span>}
                      </div>
                      <p className="mt-2 text-xs font-semibold tracking-wide text-violet-700 uppercase">{getEventTypeLabel(bandEvent.event_type)}</p>
                      {bandEvent.description?.trim() && <p className="mt-3 break-words whitespace-pre-wrap text-sm leading-6 text-zinc-600"><LinkifiedText text={bandEvent.description} /></p>}
                    </div>
                    <div className={`w-full shrink-0 rounded-xl px-4 py-3 sm:w-auto sm:min-w-44 ${isUpcoming ? "bg-violet-50" : "bg-zinc-50"}`}>
                      <p className="text-sm font-semibold text-zinc-900">{formatEventDate(bandEvent.start_at)}</p>
                      <p className="mt-1 text-sm tabular-nums text-zinc-600">
                        {formatEventTime(bandEvent.start_at)}
                        {bandEvent.end_at && <> – {formatEventTime(bandEvent.end_at)}</>}
                      </p>
                    </div>
                  </div>
                  {bandEvent.location?.trim() && (
                    <p className="mt-4 border-t border-zinc-100 pt-3 text-sm text-zinc-600">
                      <span className="font-medium text-zinc-800">Local:</span> {bandEvent.location}
                    </p>
                  )}
                  {(tasksByEvent[bandEvent.id]?.length ?? 0) > 0 && (
                    <div className="mt-4 border-t border-zinc-100 pt-4">
                      <h3 className="text-sm font-semibold text-zinc-800">Tarefas relacionadas</h3>
                      <ul className="mt-3 space-y-2">
                        {tasksByEvent[bandEvent.id].map((task) => (
                          <li key={task.id} className="flex min-w-0 flex-col gap-2 rounded-xl bg-zinc-50 px-3 py-3 sm:flex-row sm:items-center sm:justify-between">
                            <span className="break-words text-sm font-medium text-zinc-800">{task.title}</span>
                            <span className="flex flex-wrap gap-2">
                              <span className="rounded-full bg-violet-50 px-2.5 py-1 text-xs font-semibold text-violet-700">{getStatusLabel(task.status)}</span>
                              <span className="rounded-full bg-zinc-200 px-2.5 py-1 text-xs font-semibold text-zinc-700">Prioridade: {getPriorityLabel(task.priority)}</span>
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  <div className="mt-4 flex flex-wrap justify-end gap-2 border-t border-zinc-100 pt-3">
                    <button
                      type="button"
                      onClick={() => startEditingEvent(bandEvent)}
                      disabled={isSubmitting || deletingEventId !== null}
                      className="inline-flex min-h-10 items-center rounded-xl border border-violet-200 px-4 py-2 text-sm font-semibold text-violet-800 transition hover:bg-violet-50 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      Editar
                    </button>
                    {isAdmin && (
                      <div>
                      <button
                        type="button"
                        onClick={() => void handleDeleteEvent(bandEvent)}
                        disabled={deletingEventId !== null}
                        className="inline-flex min-h-10 items-center rounded-xl border border-red-200 px-4 py-2 text-sm font-semibold text-red-700 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {deletingEventId === bandEvent.id ? "Excluindo..." : "Excluir"}
                      </button>
                      </div>
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
