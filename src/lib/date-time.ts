// Calendar deadlines use Sao Paulo regardless of the viewer's device timezone.
export const DEADLINE_TIME_ZONE = "America/Sao_Paulo";

export function calendarDay(value: string | number, timeZone = DEADLINE_TIME_ZONE): string {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return validCalendarDay(value) ? value : "";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(date);
  const part = (type: string) => parts.find((item) => item.type === type)?.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function validCalendarDay(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function formatTaskDate(value: string): string {
  const day = calendarDay(value);
  if (!day) return "Data inválida";
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "medium", timeZone: "UTC" })
    .format(new Date(`${day}T12:00:00.000Z`));
}

export function isTaskOverdue(task: { status: string; due_date: string | null }, now: number): boolean {
  if (task.status === "done" || !task.due_date) return false;
  const deadline = calendarDay(task.due_date);
  return !!deadline && deadline < calendarDay(now);
}

export function taskDeadlinePatch(value: string, original?: string | null): { due_date?: string | null } {
  // Omit untouched fields: this also preserves sub-millisecond database precision.
  if (original !== undefined && value === (original ? calendarDay(original) : "")) return {};
  if (!value) return { due_date: null };
  if (!validCalendarDay(value)) throw new Error("Informe um prazo válido.");
  // Compatibility convention for the existing timestamptz column: noon UTC is
  // on the chosen calendar day in Sao Paulo. Never use the device's timezone.
  return { due_date: `${value}T12:00:00.000Z` };
}

export function toLocalDateTimeInput(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

export function parseLocalDateTime(value: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return new Date(Number.NaN);
  const [year, month, day, hour, minute] = value.split(/[-T:]/).map(Number);
  const date = new Date(year, month - 1, day, hour, minute);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day ||
      date.getHours() !== hour || date.getMinutes() !== minute) return new Date(Number.NaN);
  return date;
}

type EventSchedule = { start_at: string; end_at: string | null };

export function eventSchedulePatch(start: string, end: string, original?: EventSchedule): Partial<EventSchedule> {
  const patch: Partial<EventSchedule> = {};
  if (!original || start !== toLocalDateTimeInput(original.start_at)) {
    patch.start_at = parseLocalDateTime(start).toISOString();
  }
  if (!original || end !== (original.end_at ? toLocalDateTimeInput(original.end_at) : "")) {
    patch.end_at = end ? parseLocalDateTime(end).toISOString() : null;
  }
  return patch;
}

export function validateEventSchedule(
  start: string, end: string, now: number, original?: EventSchedule, current = original,
): string | null {
  const startChanged = !original || start !== toLocalDateTimeInput(original.start_at);
  const endChanged = !original || end !== (original.end_at ? toLocalDateTimeInput(original.end_at) : "");
  const startDate = startChanged ? parseLocalDateTime(start) : new Date(current!.start_at);
  const endDate = endChanged ? (end ? parseLocalDateTime(end) : null) : (current?.end_at ? new Date(current.end_at) : null);
  if (!start || Number.isNaN(startDate.getTime()) || (endDate && Number.isNaN(endDate.getTime()))) {
    return "Informe uma data e horário válidos.";
  }
  if (startChanged && startDate.getTime() < now) return "O início do evento não pode estar no passado.";
  if (endDate && endDate < startDate) return "O término não pode ser anterior ao início.";
  return null;
}

export function differentLocalEventDays(start: string, end: string): boolean {
  return calendarDay(start, Intl.DateTimeFormat().resolvedOptions().timeZone) !==
    calendarDay(end, Intl.DateTimeFormat().resolvedOptions().timeZone);
}

// Refresh on resume (including Safari's page cache), and while the page stays open.
export function watchPageClock(update: (now: number) => void): () => void {
  const refresh = () => { if (document.visibilityState !== "hidden") update(Date.now()); };
  window.addEventListener("focus", refresh);
  window.addEventListener("pageshow", refresh);
  document.addEventListener("visibilitychange", refresh);
  const interval = window.setInterval(refresh, 30_000);
  refresh();
  return () => {
    window.clearInterval(interval);
    window.removeEventListener("focus", refresh);
    window.removeEventListener("pageshow", refresh);
    document.removeEventListener("visibilitychange", refresh);
  };
}
