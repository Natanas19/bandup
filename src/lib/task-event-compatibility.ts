import type { SupabaseClient } from "@supabase/supabase-js";

const baseColumns = "id, title, description, status, priority, due_date, assigned_to, created_at, created_by";

export function taskColumns(supportsEvents: boolean, v2 = false) {
  if (v2) return `${baseColumns.replace(", assigned_to", "")}, event_id, task_revision, task_assignees(user_id)`;
  return supportsEvents ? `${baseColumns}, event_id` : baseColumns;
}

export function isMissingTaskEventColumn(error: { code?: string; message?: string } | null) {
  return (error?.code === "42703" &&
    /^column (?:public\.)?tasks\.event_id does not exist$/.test(error.message ?? ""))
    || (error?.code === "PGRST204" &&
      error.message === "Could not find the 'event_id' column of 'tasks' in the schema cache");
}

export async function readTasksWithEventSupport(client: SupabaseClient, bandId: string, v2 = false) {
  const read = (supportsEvents: boolean) => client.from("tasks")
    .select(taskColumns(supportsEvents, v2)).eq("band_id", bandId)
    .order("due_date", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: false });
  const result = await read(true);
  if (v2 || !isMissingTaskEventColumn(result.error)) return { ...result, supportsEvents: true };
  return { ...await read(false), supportsEvents: false };
}

export function taskEventValues(supportsEvents: boolean, eventId: string) {
  if (!supportsEvents && eventId) {
    throw new Error("Este ambiente não permite vincular tarefas a eventos. Remova o evento selecionado para salvar a tarefa.");
  }
  return supportsEvents ? { event_id: eventId || null } : {};
}
