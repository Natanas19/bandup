import type { SupabaseClient } from "@supabase/supabase-js";
import { avatarObjectPath, validateAvatarFile } from "./avatar-upload";
import { bandPhotoSession } from "./band-logo-upload";

export { AVATAR_MIME_TYPES as EVENT_FLYER_MIME_TYPES, validateAvatarFile as validateEventFlyer } from "./avatar-upload";

export const EVENT_FLYER_URL_SECONDS = 60;
const bucket = "event-flyers";
export class EventFlyerError extends Error {}

export function isMissingEventFlyerColumn(error: { code?: string; message?: string } | null) {
  return error?.code === "42703" && /^column (?:public\.)?events\.flyer_path does not exist$/.test(error.message ?? "");
}

function eventFlyerPath(bandId: string, eventId: string, mime: string, attempt: string) {
  const eventPath = avatarObjectPath(eventId, mime, attempt);
  return eventPath && avatarObjectPath(bandId, mime, attempt) ? `${bandId}/${eventPath}` : null;
}

export async function signEventFlyer(client: SupabaseClient, path: string) {
  const { data, error } = await client.storage.from(bucket).createSignedUrl(path, EVENT_FLYER_URL_SECONDS);
  if (error || !data?.signedUrl) throw new Error("Não foi possível abrir o flyer.");
  const url = new URL(data.signedUrl);
  const origin = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").origin;
  if (url.origin !== origin || url.pathname !== `/storage/v1/object/sign/${bucket}/${path}`
    || url.username || url.password || url.hash || !url.searchParams.get("token")) {
    throw new Error("Link do flyer inválido.");
  }
  return url.href;
}

export async function saveEventFlyer(client: SupabaseClient, userId: string, bandId: string,
  eventId: string, previousPath: string | null, file: File | null): Promise<string | null> {
  const nextPath = file ? eventFlyerPath(bandId, eventId, file.type, crypto.randomUUID()) : null;
  if (file && (validateAvatarFile(file) || !nextPath)) throw new EventFlyerError("Escolha um flyer válido.");

  const signal = AbortSignal.timeout(30_000);
  const { scoped, verify } = await bandPhotoSession(client, userId, signal).catch(() => {
    throw new EventFlyerError("Não foi possível verificar a sessão para alterar o flyer.");
  });
  const event = () => scoped.from("events").select("flyer_path").eq("id", eventId).eq("band_id", bandId).maybeSingle();
  const before = await event();
  if (before.error || !before.data) throw new EventFlyerError("Não foi possível verificar o flyer atual.");
  if (before.data.flyer_path === nextPath) return nextPath;
  if (before.data.flyer_path !== previousPath) throw new EventFlyerError("O flyer mudou. Atualize a agenda antes de tentar novamente.");

  if (file && nextPath) {
    const uploaded = await scoped.storage.from(bucket).upload(nextPath, file, {
      contentType: file.type, upsert: false, cacheControl: "60",
    }).catch(() => null);
    if (!uploaded || uploaded.error) throw new EventFlyerError("Não foi possível confirmar o envio do flyer. Verifique sua conexão e permissão.");
  }
  await verify();
  const update = scoped.from("events").update({ flyer_path: nextPath }).eq("id", eventId).eq("band_id", bandId);
  const conditional = previousPath === null ? update.is("flyer_path", null) : update.eq("flyer_path", previousPath);
  const result = await Promise.resolve(conditional.select("flyer_path").maybeSingle()).catch(() => null);
  if (result?.error?.code === "42501") throw new EventFlyerError("Você não tem permissão para alterar este flyer.");

  // A dropped response can follow a committed update. Confirm by reading once.
  const outcome = result?.data && !result.error ? result : await Promise.resolve(event()).catch(() => null);
  await verify();
  if (outcome?.error || !outcome?.data || outcome.data.flyer_path !== nextPath) {
    throw new EventFlyerError("Não foi possível confirmar a alteração do flyer. Atualize a agenda para conferir.");
  }
  return nextPath;
}
