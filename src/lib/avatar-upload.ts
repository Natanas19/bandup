import type { SupabaseClient, User } from "@supabase/supabase-js";

export const AVATAR_MAX_BYTES = 2 * 1024 * 1024;
export const AVATAR_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

const extensionByMime: Record<(typeof AVATAR_MIME_TYPES)[number], string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

export type AvatarUploadFailureStage = "validation" | "session" | "upload" | "profile";

export class AvatarUploadError extends Error {
  constructor(readonly stage: AvatarUploadFailureStage) {
    super("Não foi possível concluir o envio da foto de perfil.");
    this.name = "AvatarUploadError";
  }
}

export function validateAvatarFile(file: Pick<File, "type" | "size">): string | null {
  if (!AVATAR_MIME_TYPES.includes(file.type as (typeof AVATAR_MIME_TYPES)[number])) {
    return "Escolha uma imagem JPG, PNG ou WebP.";
  }
  if (!Number.isFinite(file.size) || file.size <= 0 || file.size > AVATAR_MAX_BYTES) {
    return "A foto deve ter até 2 MB.";
  }
  return null;
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const userUuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;

function cancellable<T>(work: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return work;
  return new Promise((resolve, reject) => {
    const abort = () => { signal.removeEventListener("abort", abort); reject(new AvatarUploadError("session")); };
    signal.addEventListener("abort", abort, { once: true });
    // Always observe work's rejection, even if the caller has already cancelled.
    work.then(value => { signal.removeEventListener("abort", abort); resolve(value); },
      cause => { signal.removeEventListener("abort", abort); reject(cause); });
    if (signal.aborted) abort();
  });
}

export function avatarObjectPath(userId: string, mimeType: string, attemptId: string): string | null {
  const extension = extensionByMime[mimeType as keyof typeof extensionByMime];
  return AVATAR_MIME_TYPES.includes(mimeType as (typeof AVATAR_MIME_TYPES)[number])
    && userUuid.test(userId) && uuid.test(attemptId) ? `${userId}/${attemptId}.${extension}` : null;
}

// The same attempt ID is retained for retries. Objects are immutable and never
// automatically removed: a lost response cannot justify deleting a linked photo.
export async function uploadAvatarForUser(
  client: SupabaseClient, userId: string, file: File, attemptId: string, signal?: AbortSignal,
): Promise<string> {
  if (validateAvatarFile(file)) throw new AvatarUploadError("validation");
  const selectedPath = avatarObjectPath(userId, file.type, attemptId);
  if (!selectedPath) throw new AvatarUploadError("validation");
  const path = selectedPath;

  if (signal?.aborted) throw new AvatarUploadError("session");
  const { data: sessionData, error: sessionError } = await cancellable(client.auth.getSession(), signal);
  const token = sessionData.session?.access_token;
  if (sessionError || !token || sessionData.session?.user.id !== userId) throw new AvatarUploadError("session");
  const configuredUrl = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "");
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!key || configuredUrl.username || configuredUrl.password || configuredUrl.search || configuredUrl.hash) {
    throw new AvatarUploadError("session");
  }
  const { isLaboratoryHttpOrigin } = await import("@/lib/development-lab");
  if (configuredUrl.protocol !== "https:" && !isLaboratoryHttpOrigin(configuredUrl.origin, "public")) {
    throw new AvatarUploadError("session");
  }
  const origin = configuredUrl.origin;
  const headers = { apikey: key, Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  async function verifiedUser() {
    if (signal?.aborted) throw new AvatarUploadError("session");
    const { data: current, error } = await cancellable(client.auth.getSession(), signal);
    if (error || current.session?.user.id !== userId) throw new AvatarUploadError("session");
    // A fixed-JWT GET cannot mutate/clear the shared Auth session, even if its
    // token has been revoked while another account is entering in another tab.
    const response = await cancellable(fetch(`${origin}/auth/v1/user`, { headers, signal, cache: "no-store" }), signal);
    if (!response.ok) throw new AvatarUploadError("session");
    const user = await cancellable(response.json() as Promise<User>, signal);
    if (signal?.aborted || user?.id !== userId || user.is_anonymous) {
      throw new AvatarUploadError("session");
    }
    const { data: after, error: afterError } = await cancellable(client.auth.getSession(), signal);
    if (signal?.aborted || afterError || after.session?.user.id !== userId) throw new AvatarUploadError("session");
    return user;
  }
  let user = await verifiedUser();
  const { createClient } = await import("@supabase/supabase-js");
  // This client never persists/refreshes Auth or reads a later browser session.
  const scoped = createClient(origin, key, { accessToken: async () => token,
    global: { fetch: (input, init) => fetch(input, { ...init, signal }) } });
  const storage = scoped.storage.from("avatars");
  const publicUrl = storage.getPublicUrl(path).data.publicUrl;
  if (user.user_metadata?.avatar_url === publicUrl) return publicUrl;

  async function objectMatches() {
    const { data, error } = await storage.info(path);
    return !error && data?.size === file.size && data.contentType === file.type;
  }
  if (!await objectMatches()) {
    await verifiedUser();
    const { error } = await storage.upload(path, file, {
      cacheControl: "3600", contentType: file.type, upsert: false,
    });
    // Includes duplicate-path and lost-response cases. Do not overwrite or delete.
    if (error && !await objectMatches()) throw new AvatarUploadError("upload");
  }

  await verifiedUser();
  try {
    // Auth's /user endpoint always updates the owner of this fixed verified JWT.
    // Avoid auth.updateUser(), which reads and persists the mutable shared session.
    await fetch(`${origin}/auth/v1/user`, { method: "PUT", signal,
      headers,
      body: JSON.stringify({ data: { avatar_url: publicUrl } }),
    });
  } catch {
    // A write may have committed. Reconcile with the same JWT below, never delete.
  }
  user = await verifiedUser();
  if (user.user_metadata?.avatar_url !== publicUrl) throw new AvatarUploadError("profile");
  return publicUrl;
}
