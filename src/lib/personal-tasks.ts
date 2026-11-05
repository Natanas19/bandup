import type { SupabaseClient } from "@supabase/supabase-js";

export const PERSONAL_TASK_PAGE_SIZE = 50;
export class PersonalTasksLoadError extends Error {}
export type PersonalTask = {
  id: string; band_id: string; assigned_to: string | null; title: string;
  status: string | null; priority: string | null; due_date: string | null; created_at: string;
  bandName: string;
};
export type PersonalTasksPage = { tasks: PersonalTask[]; hasMore: boolean };
type Membership = { band_id: string; role: string; band: { id: string; name: string } | null };
type TaskRow = Omit<PersonalTask, "bandName">;

// Session client only. These filters supplement database RLS; they never replace it.
export async function loadPersonalTasks(client: SupabaseClient, offset = 0): Promise<PersonalTasksPage> {
  if (!Number.isSafeInteger(offset) || offset < 0) throw new PersonalTasksLoadError("Página de tarefas inválida.");
  const { data: account, error: authError } = await client.auth.getUser();
  if (authError || !account.user) throw new PersonalTasksLoadError("Não foi possível verificar sua conta. Entre novamente ou tente atualizar.");
  const userId = account.user.id;
  const bands = new Map<string, string>();
  // Page memberships too: never silently truncate the authorized band set.
  for (let start = 0; ; start += 200) {
    const { data, error } = await client.from("band_members")
      .select("band_id, role, band:bands!inner(id, name)").eq("user_id", userId)
      .order("band_id", { ascending: true }).range(start, start + 199);
    if (error) throw new PersonalTasksLoadError("Não foi possível verificar suas bandas e permissões. Tente novamente.");
    const rows = (data ?? []) as unknown as Membership[];
    for (const row of rows) {
      if ((row.role === "admin" || row.role === "member") && row.band?.id === row.band_id) {
        bands.set(row.band_id, row.band.name);
      }
    }
    if (rows.length < 200) break;
  }
  if (!bands.size) return { tasks: [], hasMore: false };
  // No event_id, task/event joins or write methods in this personal read path.
  const query = client.from("tasks")
    .select("id, band_id, assigned_to, title, status, priority, due_date, created_at")
    .eq("assigned_to", userId).in("band_id", [...bands.keys()]);
  const { data, error } = await query
    .order("due_date", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: false }).order("id", { ascending: true })
    .range(offset, offset + PERSONAL_TASK_PAGE_SIZE);
  if (error) throw new PersonalTasksLoadError("Não foi possível carregar suas tarefas. Seu acesso pode ter mudado. Tente novamente.");
  const rows = (data ?? []) as unknown as TaskRow[];
  if (rows.some(row => !bands.has(row.band_id) || row.assigned_to !== userId)) {
    throw new PersonalTasksLoadError("Não foi possível confirmar o acesso às tarefas retornadas. Atualize a página.");
  }
  return {
    tasks: rows.slice(0, PERSONAL_TASK_PAGE_SIZE).map(row => ({ ...row, bandName: bands.get(row.band_id)! })),
    hasMore: rows.length > PERSONAL_TASK_PAGE_SIZE,
  };
}
