import type { SupabaseClient } from "@supabase/supabase-js";
import { bandPhotoSession } from "./band-logo-upload";

const unavailable = () => new Error("Não foi possível confirmar sua disponibilidade. Verifique novamente antes de alterar.");

async function session(client: SupabaseClient, userId: string, signal: AbortSignal) {
  if (!userId || signal.aborted) throw unavailable();
  return bandPhotoSession(client, userId, signal);
}

async function read(scoped: SupabaseClient, userId: string) {
  const { data, error } = await scoped.from("musician_availability").select("available")
    .eq("user_id", userId).maybeSingle();
  if (error || (data !== null && typeof data?.available !== "boolean")) throw unavailable();
  return { exists: data !== null, available: data?.available ?? false };
}

export async function loadMusicianAvailability(client: SupabaseClient, userId: string, signal: AbortSignal): Promise<boolean> {
  const { scoped, verify } = await session(client, userId, signal);
  const row = await read(scoped, userId);
  await verify();
  return row.available;
}

export async function saveMusicianAvailability(client: SupabaseClient, userId: string,
  available: boolean, signal: AbortSignal): Promise<boolean> {
  if (typeof available !== "boolean") throw unavailable();
  const { scoped, verify } = await session(client, userId, signal);
  const before = await read(scoped, userId);
  await verify();
  if (before.available === available) return before.available;
  try {
    const result = before.exists
      ? await scoped.from("musician_availability").update({ available }).eq("user_id", userId)
      : await scoped.from("musician_availability").insert({ user_id: userId, available });
    if (result.error) throw unavailable();
  } catch {
    // Lost reply or concurrent creation: reconcile once, never retry a mutation.
    if (signal.aborted) throw unavailable();
  }
  await verify();
  const after = await read(scoped, userId);
  await verify();
  if (after.available !== available) throw unavailable();
  return after.available;
}
