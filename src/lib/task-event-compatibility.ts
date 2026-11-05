import type { SupabaseClient } from "@supabase/supabase-js";

const baseColumns = "id, title, description, status, priority, due_date, assigned_to, created_at, created_by";

export function taskColumns(supportsEvents: boolean) {
  return supportsEvents ? `${baseColumns}, event_id` : baseColumns;
}

export function isMissingTaskEventColumn(error: { code?: string; message?: string } | null) {
  // Only the confirmed PostgreSQL missing-column diagnostic permits a fallback.
  return error?.code === "42703" &&
    /^column tasks\.event_id does not exist$/.test(error.message ?? "");
}

export async function readTasksWithEventSupport(client: SupabaseClient, bandId: string) {
  const read = (supportsEvents: boolean) => client.from("tasks")
    .select(taskColumns(supportsEvents)).eq("band_id", bandId)
    .order("due_date", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: false });
  const result = await read(true);
  if (!isMissingTaskEventColumn(result.error)) return { ...result, supportsEvents: true };
  return { ...await read(false), supportsEvents: false };
}

export function taskEventValues(supportsEvents: boolean, eventId: string) {
  if (!supportsEvents && eventId) {
    throw new Error("Este ambiente não permite vincular tarefas a eventos. Remova o evento selecionado para salvar a tarefa.");
  }
  return supportsEvents ? { event_id: eventId || null } : {};
}
