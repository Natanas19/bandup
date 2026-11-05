import type { SupabaseClient } from "@supabase/supabase-js";

export type LoginSessionResult = { authenticated: boolean; message: string };

export const confirmationFailure = "Não foi possível concluir a confirmação ou iniciar sua sessão. O link pode estar expirado, inválido ou já ter sido usado. Confira o link mais recente recebido no e-mail cadastrado. Se já confirmou seu e-mail, entre com sua senha abaixo.";
export const sessionFailure = "Não foi possível verificar sua sessão. Entre com seu e-mail e senha abaixo.";

// URL data is only a hint for presentation, never proof of confirmation.
export function isAuthReturn(url: URL) {
  const hash = new URLSearchParams(url.hash.slice(1));
  const keys = ["access_token", "refresh_token", "code", "token_hash", "error", "error_code", "error_description", "type"];
  return keys.some(key => url.searchParams.has(key) || hash.has(key));
}

export async function resolveLoginSession(client: SupabaseClient, url: URL): Promise<LoginSessionResult> {
  const callback = isAuthReturn(url);
  const fail = (message = callback ? confirmationFailure : sessionFailure) => ({ authenticated: false, message });
  const hash = new URLSearchParams(url.hash.slice(1));
  const param = (key: string) => url.searchParams.get(key) ?? hash.get(key);
  try {
    // The existing SDK consumes implicit-flow tokens and persists the session.
    // Await its actual initialization result: getSession alone can hide a URL error
    // while retaining an older session. Never exchange or replay tokens ourselves.
    const initialized = await client.auth.initialize();
    if (initialized.error || ["error", "error_code", "error_description"].some(key => url.searchParams.has(key) || hash.has(key))) return fail();
    // This screen confirms signup, not password recovery or arbitrary OTP types.
    if (callback && param("type") && param("type") !== "signup") return fail();
    if (param("token_hash") || param("code")) return fail(); // Unsupported by the current implicit signup configuration.
    if (callback && (!param("access_token") || !param("refresh_token"))) return fail();
    const { data, error } = await client.auth.getSession();
    const session = data.session;
    if (error) return fail();
    if (!session) return callback ? fail() : { authenticated: false, message: "" };
    const verified = await client.auth.getUser();
    if (verified.error || !verified.data.user?.email_confirmed_at
      || verified.data.user.id !== session.user.id
      || !session.access_token || !session.expires_at || session.expires_at * 1000 <= Date.now()) return fail();
    return { authenticated: true, message: "" };
  } catch { return fail(); }
}
