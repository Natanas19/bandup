"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import CardDetails, { toggleCardDetails } from "@/components/card-details";
import { EventFlyerLayout } from "@/components/event-flyer";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { loadPersonalAgenda, PersonalAgendaLoadError, type PersonalEvent } from "@/lib/personal-agenda";

const eventTypeLabels: Record<string, string> = {
  show: "Show",
  rehearsal: "Ensaio",
  recording: "Gravação",
  meeting: "Reunião",
  interview: "Entrevista",
  photoshoot: "Fotoshoot",
  livestream: "Livestream",
  other: "Outro",
};

const dateFormatter = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "long", year: "numeric" });
const timeFormatter = new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

function formatEventDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Data indisponível" : dateFormatter.format(date);
}

function formatEventTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Horário indisponível" : timeFormatter.format(date);
}

function sortEvents(events: PersonalEvent[]) {
  const now = Date.now();
  return [...events].sort((first, second) => {
    const firstStart = Date.parse(first.start_at);
    const secondStart = Date.parse(second.start_at);
    const firstUpcoming = firstStart >= now;
    const secondUpcoming = secondStart >= now;
    if (firstUpcoming !== secondUpcoming) return firstUpcoming ? -1 : 1;
    return firstUpcoming ? firstStart - secondStart : secondStart - firstStart;
  });
}

export default function PersonalAgenda() {
  const [events, setEvents] = useState<PersonalEvent[] | null>(null);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    let active = true;
    setEvents(null);
    setError("");
    void loadPersonalAgenda(getSupabaseBrowserClient()).then(result => {
      if (active) setEvents(result);
    }).catch(cause => {
      if (!active) return;
      setError(cause instanceof PersonalAgendaLoadError
        ? cause.message
        : "Não foi possível carregar sua agenda. Tente novamente.");
    });
    return () => { active = false; };
  }, [revision]);

  return <main className="min-w-0 flex-1 px-4 py-6 sm:px-6 sm:py-8 lg:px-10 lg:py-10">
    <div className="mx-auto w-full max-w-4xl">
      <header>
        <p className="text-xs font-semibold uppercase tracking-widest text-accent">Meu Painel</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-content sm:text-4xl">Agenda</h1>
        <p className="mt-3 text-sm leading-6 text-content-muted">Eventos de todas as bandas de que você participa.</p>
      </header>

      {error ? <section className="mt-7 rounded-2xl border border-nav-border bg-surface p-5">
        <p role="alert" className="text-sm text-danger">{error}</p>
        <button type="button" onClick={() => setRevision(value => value + 1)}
          className="mt-4 min-h-11 rounded-xl border border-accent-border px-4 py-3 text-sm font-semibold text-brand hover:bg-accent-soft focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-focus">Tentar novamente</button>
      </section> : events === null ? <p role="status" className="mt-7 text-sm text-content-muted">Carregando sua agenda...</p>
        : events.length === 0 ? <section className="mt-7 rounded-2xl border border-dashed border-accent-border bg-surface p-6 sm:p-10">
          <h2 className="text-xl font-semibold text-content">Nenhum evento encontrado</h2>
          <p className="mt-3 text-sm leading-6 text-content-muted">Quando uma das suas bandas adicionar eventos à agenda, eles aparecerão aqui.</p>
        </section> : <section aria-label="Eventos das suas bandas" className="mt-7 space-y-3">
          {sortEvents(events).map(event => <article key={`${event.band_id}:${event.id}`} onClick={toggleCardDetails} className="min-w-0 rounded-2xl border border-nav-border bg-surface p-4 shadow-app-card sm:p-6">
            <EventFlyerLayout path={event.flyer_path} title={event.title}>
              <div className="flex min-w-0 flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <h2 className="break-words text-lg font-semibold text-content [overflow-wrap:anywhere] sm:text-xl">{event.title}</h2>
                  <p className="mt-2 text-xs font-semibold uppercase tracking-wide text-accent">{eventTypeLabels[event.event_type] ?? event.event_type}</p>
                  <p className="mt-3 text-sm text-content-muted">Banda responsável</p>
                  <Link href={`/bandas/${event.band_id}/agenda`} className="mt-1 inline-flex min-h-11 items-center break-words font-semibold text-brand underline decoration-accent-border underline-offset-4 hover:text-brand-hover focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-focus [overflow-wrap:anywhere]">
                    {event.bandName}
                  </Link>
                </div>
                <div className="w-full shrink-0 rounded-xl bg-accent-soft px-4 py-3 sm:w-auto sm:min-w-48">
                  <p className="text-sm font-semibold text-content">{formatEventDate(event.start_at)}</p>
                  <p className="mt-1 text-sm tabular-nums text-content-muted">
                    {formatEventTime(event.start_at)}
                    {event.end_at && <> – {formatEventDate(event.end_at) !== formatEventDate(event.start_at)
                      && <>{formatEventDate(event.end_at)} às </>}{formatEventTime(event.end_at)}</>}
                  </p>
                </div>
              </div>
              {event.location?.trim() && <p className="mt-4 break-words text-sm text-content-muted"><span className="font-medium text-content">Local:</span> {event.location}</p>}
            </EventFlyerLayout>
            <CardDetails title={event.title} description={event.description} />
          </article>)}
        </section>}
    </div>
  </main>;
}
