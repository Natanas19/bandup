import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";
import { normalizeDisplayName } from "./display-name";
import { isLaboratoryHttpOrigin } from "./development-lab";

export const BIO_MAX_CHARACTERS = 300;
export const bioLength = (value: string) => [...value].length;
export function safeProfilePhoto(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return !url.username && !url.password && (url.protocol === "https:" || isLaboratoryHttpOrigin(url.origin, "public")) ? url.href : null;
  } catch { return null; }
}
export function validBio(value: unknown): value is string {
  return typeof value === "string" && bioLength(value) <= BIO_MAX_CHARACTERS
    && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value);
}

export type ProfileEdits = { display_name?: string; bio?: string };
export type ProfileSaveResult = {
  user: User;
  fields: Partial<Record<keyof ProfileEdits, "saved" | "error">>;
};

function abortable<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => { signal.removeEventListener("abort", abort); reject(new Error("Operação interrompida.")); };
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
    work.then(value => { signal.removeEventListener("abort", abort); resolve(value); }, error => {
      signal.removeEventListener("abort", abort); reject(error);
    });
  });
}

// Never use the mutable shared session to select the recipient of a write.
// The isolated Auth client stores/refreshes only this account's session in memory.
export async function savePersonalMetadata(client: SupabaseClient, ownerId: string,
  edits: ProfileEdits, signal: AbortSignal): Promise<ProfileSaveResult> {
  const patch: ProfileEdits = {};
  if (edits.display_name !== undefined) {
    const name = normalizeDisplayName(edits.display_name);
    if (!name) throw new Error("Informe um nome válido de até 80 caracteres.");
    patch.display_name = name;
  }
  if (edits.bio !== undefined) {
    if (!validBio(edits.bio)) throw new Error("A descrição deve ter até 300 caracteres válidos.");
    patch.bio = edits.bio;
  }
  const controller = new AbortController();
  const cancel = () => controller.abort();
  signal.addEventListener("abort", cancel, { once: true });
  if (signal.aborted) cancel();
  const { data: listener } = client.auth.onAuthStateChange((_event, session) => {
    if (session?.user.id !== ownerId) cancel();
  });
  const assertOwner = async () => {
    if (controller.signal.aborted) throw new Error("Sua sessão mudou. Atualize a página antes de salvar.");
    const { data, error } = await abortable(client.auth.getSession(), controller.signal);
    if (error || data.session?.user.id !== ownerId || controller.signal.aborted) {
      throw new Error("Sua sessão mudou. Atualize a página antes de salvar.");
    }
    return data.session;
  };
  try {
    const session = await assertOwner();
    // Keep the isolated client outside the SDK's 90s refresh margin for the
    // bounded 30s save. It must not rotate the shared account's refresh token.
    if (!session.access_token || !session.refresh_token || !session.expires_at
      || session.expires_at * 1000 - Date.now() <= 120000) throw new Error("Recarregue a página para renovar sua sessão antes de salvar.");
    const origin = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "");
    const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    if (!key || origin.username || origin.password || origin.search || origin.hash
      || (origin.protocol !== "https:" && !isLaboratoryHttpOrigin(origin.origin, "public"))) {
      throw new Error("Não foi possível validar a conexão da conta.");
    }
    const scoped = createClient(origin.origin, key, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: { fetch: async (input, init) => {
        await assertOwner();
        return fetch(input, { ...init, signal: controller.signal });
      } },
    });
    const { data: pinned, error: pinError } = await scoped.auth.setSession({
      access_token: session.access_token, refresh_token: session.refresh_token,
    });
    if (pinError || pinned.user?.id !== ownerId) throw new Error("Não foi possível verificar sua conta.");
    const verify = async () => {
      await assertOwner();
      const { data, error } = await scoped.auth.getUser();
      await assertOwner();
      if (error || data.user?.id !== ownerId || data.user.is_anonymous) throw new Error("Não foi possível confirmar os dados da conta.");
      return data.user;
    };
    let user = await verify();
    const fields: ProfileSaveResult["fields"] = {};
    for (const field of ["display_name", "bio"] as const) {
      if (patch[field] === undefined) continue;
      await verify();
      try {
        // Explicit one-field patches preserve all other metadata; never include email.
        await scoped.auth.updateUser({ data: { [field]: patch[field] } });
      } catch { /* A lost response may have committed. Confirm before reporting. */ }
      user = await verify();
      fields[field] = user.user_metadata?.[field] === patch[field] ? "saved" : "error";
    }
    return { user, fields };
  } finally {
    signal.removeEventListener("abort", cancel);
    listener.subscription.unsubscribe();
    controller.abort();
  }
}
