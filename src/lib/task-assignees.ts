import type { SupabaseClient } from "@supabase/supabase-js";

export type TaskWriteMode = "legacy" | "v2";
export function multipleTaskAssigneesEnabled() {
  return process.env.NEXT_PUBLIC_BANDUP_MULTI_ASSIGNEES_ENABLED === "true";
}

export async function readTaskWriteMode(client: SupabaseClient, bandId: string): Promise<TaskWriteMode> {
  const { error } = await client.from("tasks").select("task_revision").eq("band_id", bandId).limit(1);
  if (!error) return "v2";
  if ((error.code === "42703" && /^column (?:public\.)?tasks\.task_revision does not exist$/.test(error.message))
    || (error.code === "PGRST204" && error.message === "Could not find the 'task_revision' column of 'tasks' in the schema cache")) {
    return "legacy";
  }
  throw error;
}

export async function readTaskMembers(client: SupabaseClient, bandId: string) {
  const members: { user_id: string }[] = [];
  for (let offset = 0; ; offset += 200) {
    const { data, error } = await client.from("band_members").select("user_id")
      .eq("band_id", bandId).order("user_id").range(offset, offset + 199);
    if (error) return { data: null, error };
    members.push(...(data ?? []));
    if (!data || data.length < 200) return { data: members, error: null };
  }
}

type TaskV2Values = {
  title: string; description: string | null; status: string; priority: string;
  due_date: string | null; event_id: string | null;
};

export async function saveTaskV2(client: SupabaseClient, bandId: string, taskId: string,
  revision: number | null, values: TaskV2Values, assignees: string[] | null, authorization: string) {
  const { data, error } = await client.rpc("bandup_save_task_v2", {
    p_band_id: bandId,
    p_task_id: taskId,
    p_expected_revision: revision,
    p_title: values.title,
    p_description: values.description,
    p_status: values.status,
    p_priority: values.priority,
    p_due_date: values.due_date,
    p_event_id: values.event_id,
    p_assignee_ids: assignees,
  }).setHeader("Authorization", authorization).retry(false);
  if (error) throw error;
  if (data?.id !== taskId || !Number.isSafeInteger(data.revision) || data.revision < 0
    || (data.status !== "saved" && (revision !== null || data.status !== "already_exists"))) {
    throw new Error("Invalid task save confirmation");
  }
  return { revision: data.revision as number, alreadyExists: data.status === "already_exists" };
}

export function newTaskId() {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
