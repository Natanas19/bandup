"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

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
  event_type: EventType;
  start_at: string;
  end_at: string | null;
  location: string | null;
  created_at: string;
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

function getEventTypeLabel(eventType: EventType) {
  return eventTypes.find((type) => type.value === eventType)?.label ?? "Outro";
}

function getLocalDateTimeMinimum(now: number) {
  const roundedNow = Math.ceil(now / 60_000) * 60_000;
  const localDate = new Date(roundedNow);
  const localValue = new Date(roundedNow - localDate.getTimezoneOffset() * 60_000);
  return localValue.toISOString().slice(0, 16);
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
  const [events, setEvents] = useState<BandEvent[]>([]);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [minimumStartAt, setMinimumStartAt] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [formError, setFormError] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [eventType, setEventType] = useState<EventType>("show");
  const [startAt, setStartAt] = useState("");
  const [endAt, setEndAt] = useState("");
  const [location, setLocation] = useState("");

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

        setBandName(band.name);
        setEvents(sortEvents((data ?? []) as unknown as BandEvent[]));
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
    setTitle("");
    setDescription("");
    setEventType("show");
    setStartAt("");
    setEndAt("");
    setLocation("");
    setFormError("");
  }

  function openForm() {
    setMinimumStartAt(getLocalDateTimeMinimum(Date.now()));
    setFormError("");
    setIsFormOpen(true);
  }

  function toggleForm() {
    if (isSubmitting) return;
    if (isFormOpen) {
      setIsFormOpen(false);
      return;
    }
    openForm();
  }

  async function handleCreateEvent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSubmitting) return;

    setFormError("");

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
        setFormError("Sua sessão expirou. Entre novamente para criar um evento.");
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

      const { data: createdEvent, error } = await supabase
        .from("events")
        .insert({
          band_id: bandId,
          created_by: user.id,
          title: title.trim(),
          description: description.trim() || null,
          event_type: eventType,
          start_at: startDate.toISOString(),
          end_at: endDate ? endDate.toISOString() : null,
          location: location.trim() || null,
        })
        .select("id, title, description, event_type, start_at, end_at, location, created_at")
        .single();

      if (error || !createdEvent) {
        setFormError("Não foi possível criar o evento. Confira os dados e tente novamente.");
        return;
      }

      setEvents((currentEvents) => sortEvents([...currentEvents, createdEvent as unknown as BandEvent]));
      setCurrentTime(Date.now());
      resetForm();
      setIsFormOpen(false);
    } catch {
      setFormError("Não foi possível criar o evento agora. Tente novamente.");
    } finally {
      setIsSubmitting(false);
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
        <Link href={`/bandas/${bandId}`} className="inline-flex min-h-11 items-center rounded-xl border border-violet-200 px-4 py-2.5 text-sm font-semibold text-violet-800 transition hover:bg-violet-50 focus:outline-none focus:ring-4 focus:ring-violet-100">
          ← Voltar para a visão geral
        </Link>

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

        {isFormOpen && (
          <section className="mt-6 rounded-2xl border border-violet-100 bg-white p-5 shadow-[0_16px_48px_-32px_rgba(54,36,104,0.35)] sm:p-7">
            <div className="mb-5">
              <h2 className="text-lg font-semibold text-zinc-900">Novo evento</h2>
              <p className="mt-1 text-sm text-zinc-500">Informe os detalhes para adicionar à agenda da banda.</p>
            </div>
            <form onSubmit={handleCreateEvent} className="space-y-5">
              <div>
                <label htmlFor="event-title" className="mb-2 block text-sm font-medium text-zinc-700">Título *</label>
                <input id="event-title" type="text" required maxLength={200} value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Ex.: Ensaio no estúdio" className="min-h-11 w-full rounded-xl border border-zinc-200 px-4 py-3 text-sm text-zinc-900 outline-none transition placeholder:text-zinc-400 focus:border-violet-500 focus:ring-4 focus:ring-violet-100" />
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label htmlFor="event-type" className="mb-2 block text-sm font-medium text-zinc-700">Tipo *</label>
                  <select id="event-type" required value={eventType} onChange={(event) => setEventType(event.target.value as EventType)} className="min-h-11 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2.5 text-sm text-zinc-900 outline-none focus:border-violet-500 focus:ring-4 focus:ring-violet-100">
                    {eventTypes.map((type) => <option key={type.value} value={type.value}>{type.label}</option>)}
                  </select>
                </div>
                <div>
                  <label htmlFor="event-location" className="mb-2 block text-sm font-medium text-zinc-700">Local <span className="font-normal text-zinc-400">(opcional)</span></label>
                  <input id="event-location" type="text" maxLength={300} value={location} onChange={(event) => setLocation(event.target.value)} placeholder="Ex.: Estúdio central" className="min-h-11 w-full rounded-xl border border-zinc-200 px-4 py-3 text-sm text-zinc-900 outline-none transition placeholder:text-zinc-400 focus:border-violet-500 focus:ring-4 focus:ring-violet-100" />
                </div>
                <div>
                  <label htmlFor="event-start" className="mb-2 block text-sm font-medium text-zinc-700">Início *</label>
                  <input id="event-start" type="datetime-local" required min={minimumStartAt || undefined} value={startAt} disabled={isSubmitting} onChange={(event) => setStartAt(event.target.value)} className="min-h-11 w-full min-w-0 rounded-xl border border-zinc-200 bg-white px-3 py-2.5 text-sm text-zinc-900 outline-none focus:border-violet-500 focus:ring-4 focus:ring-violet-100" />
                </div>
                <div>
                  <label htmlFor="event-end" className="mb-2 block text-sm font-medium text-zinc-700">Término <span className="font-normal text-zinc-400">(opcional)</span></label>
                  <input id="event-end" type="datetime-local" min={startAt || undefined} value={endAt} disabled={isSubmitting} onChange={(event) => setEndAt(event.target.value)} className="min-h-11 w-full min-w-0 rounded-xl border border-zinc-200 bg-white px-3 py-2.5 text-sm text-zinc-900 outline-none focus:border-violet-500 focus:ring-4 focus:ring-violet-100" />
                </div>
              </div>

              <div>
                <label htmlFor="event-description" className="mb-2 block text-sm font-medium text-zinc-700">Descrição <span className="font-normal text-zinc-400">(opcional)</span></label>
                <textarea id="event-description" rows={3} maxLength={2000} value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Adicione informações úteis para os integrantes" className="w-full resize-y rounded-xl border border-zinc-200 px-4 py-3 text-sm text-zinc-900 outline-none transition placeholder:text-zinc-400 focus:border-violet-500 focus:ring-4 focus:ring-violet-100" />
              </div>

              {formError && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{formError}</p>}

              <div className="flex flex-col-reverse gap-3 pt-1 sm:flex-row sm:justify-end">
                <button type="button" disabled={isSubmitting} onClick={() => { resetForm(); setIsFormOpen(false); }} className="min-h-11 rounded-xl border border-violet-200 px-5 py-3 text-sm font-semibold text-violet-800 transition hover:bg-violet-50 disabled:opacity-60">
                  Cancelar
                </button>
                <button type="submit" disabled={isSubmitting} className="min-h-11 rounded-xl bg-violet-700 px-5 py-3 text-sm font-semibold text-white transition hover:bg-violet-800 disabled:cursor-not-allowed disabled:opacity-70">
                  {isSubmitting ? "Salvando evento..." : "Criar evento"}
                </button>
              </div>
            </form>
          </section>
        )}

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
                      {bandEvent.description?.trim() && <p className="mt-3 break-words whitespace-pre-wrap text-sm leading-6 text-zinc-600">{bandEvent.description}</p>}
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
                </article>
              );
            })}
          </section>
        )}
      </div>
    </main>
  );
}
