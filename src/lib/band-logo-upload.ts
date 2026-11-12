import type { SupabaseClient, User } from "@supabase/supabase-js";
import { avatarObjectPath, validateAvatarFile } from "./avatar-upload";
import { isLaboratoryHttpOrigin } from "./development-lab";

export { validateAvatarFile as validateBandLogoFile } from "./avatar-upload";
export class BandLogoError extends Error {
  constructor(readonly stage: "validation" | "authorization" | "upload" | "association") {
    super("Não foi possível confirmar a foto da banda.");
  }
}

function abortable<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => { signal.removeEventListener("abort", abort); reject(new BandLogoError("authorization")); };
    signal.addEventListener("abort", abort, { once: true });
    work.then(value => { signal.removeEventListener("abort", abort); resolve(value); },
      error => { signal.removeEventListener("abort", abort); reject(error); });
    if (signal.aborted) abort();
  });
}

// A captured token prevents an in-flight operation from following another account.
export async function bandPhotoSession(client: SupabaseClient, userId: string, signal: AbortSignal) {
  const { data, error } = await abortable(client.auth.getSession(), signal);
  const token = data.session?.access_token;
  if (error || !token || data.session?.user.id !== userId || signal.aborted) throw new BandLogoError("authorization");
  const url = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "");
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!key || url.username || url.password || url.search || url.hash || url.pathname !== "/"
    || (url.protocol !== "https:" && !isLaboratoryHttpOrigin(url.origin, "public"))) throw new BandLogoError("authorization");
  const { createClient } = await import("@supabase/supabase-js");
  const scoped = createClient(url.origin, key, { accessToken: async () => token,
    global: { fetch: (input, init) => fetch(input, { ...init, signal }) } });
  async function verify() {
    if (signal.aborted) throw new BandLogoError("authorization");
    const { data: current, error: currentError } = await abortable(client.auth.getSession(), signal);
    if (currentError || current.session?.user.id !== userId || signal.aborted) throw new BandLogoError("authorization");
    const response = await fetch(`${url.origin}/auth/v1/user`, { signal, cache: "no-store",
      headers: { apikey: key!, Authorization: `Bearer ${token}` } });
    if (!response.ok) throw new BandLogoError([401, 403].includes(response.status) ? "authorization" : "association");
    const user: User = await response.json();
    if (user.id !== userId || user.is_anonymous || signal.aborted) throw new BandLogoError("authorization");
    const after = await abortable(client.auth.getSession(), signal);
    if (after.error || after.data.session?.user.id !== userId || signal.aborted) throw new BandLogoError("authorization");
  }
  await verify();
  return { scoped, verify };
}

export async function uploadBandLogo(client: SupabaseClient, userId: string, bandId: string,
  file: File, attemptId: string, externalSignal: AbortSignal): Promise<string> {
  const selectedPath = avatarObjectPath(bandId, file.type, attemptId);
  if (validateAvatarFile(file) || !selectedPath) throw new BandLogoError("validation");
  const path = selectedPath;
  const controller = new AbortController();
  const abort = () => controller.abort();
  externalSignal.addEventListener("abort", abort, { once: true });
  if (externalSignal.aborted) abort();
  let timedOut = false;
  let monitorFailure: unknown;
  const timer = setTimeout(() => { timedOut = true; abort(); }, 30000);
  let monitor: ReturnType<typeof setInterval> | undefined;
  try {
    const { scoped, verify } = await bandPhotoSession(client, userId, controller.signal);
    async function authorize() {
      await verify();
      const { data, error } = await scoped.from("band_members").select("role")
        .eq("band_id", bandId).eq("user_id", userId).maybeSingle();
      if (error) throw new BandLogoError(error.code === "42501" ? "authorization" : "association");
      if (data?.role !== "admin" || controller.signal.aborted) throw new BandLogoError("authorization");
    }
    await authorize();
    // Read-only monitoring; the RPC is still the authoritative atomic check.
    let checking = false;
    monitor = setInterval(() => {
      if (checking) return;
      checking = true;
      void authorize().catch(error => { monitorFailure = error; abort(); }).finally(() => { checking = false; });
    }, 2000);
    const storage = scoped.storage.from("band-logos");
    const expected = storage.getPublicUrl(path).data.publicUrl;
    async function matches() {
      const { data, error } = await storage.info(path);
      return !error && data?.size === file.size && data.contentType === file.type;
    }
    if (!await matches()) {
      await authorize();
      let failed = false;
      try {
        const { error } = await storage.upload(path, file, { contentType: file.type, upsert: false, cacheControl: "3600" });
        failed = !!error;
      } catch { failed = true; }
      // A timeout/duplicate can have committed. Never overwrite or clean up.
      if (failed && !await matches()) throw new BandLogoError("upload");
    }
    if (!await matches()) throw new BandLogoError("upload");
    await authorize();
    let denied = false;
    try {
      const { error } = await scoped.rpc("bandup_set_band_logo", { p_band_id: bandId, p_object_path: path });
      denied = error?.code === "42501";
    } catch { /* A committed association may have lost its response. */ }
    if (denied) throw new BandLogoError("authorization");
    // Reconcile lost/error responses, and never trust success without a read.
    await authorize();
    const result = await scoped.from("bands").select("logo_url").eq("id", bandId).maybeSingle();
    if (result.error || result.data?.logo_url !== expected) throw new BandLogoError("association");
    return expected;
  } catch (error) {
    if (timedOut && !externalSignal.aborted) throw new BandLogoError("upload");
    if (monitorFailure && !externalSignal.aborted) throw monitorFailure;
    throw error;
  } finally {
    clearTimeout(timer);
    if (monitor) clearInterval(monitor);
    externalSignal.removeEventListener("abort", abort);
    controller.abort();
  }
}
