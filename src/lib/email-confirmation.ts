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
    // The SDK consumes implicit-flow tokens. Initialization may also recover an
    // older session, so the callback must be bound to its own verification result.
    const initialized = await client.auth.initialize();
    if (initialized.error || ["error", "error_code", "error_description"].some(key => url.searchParams.has(key) || hash.has(key))) return fail();
    // This screen confirms signup, not password recovery or arbitrary OTP types.
    const type = param("type");
    if (callback && type && type !== "signup" && type !== "email") return fail();
    if (param("code")) return fail(); // PKCE requires a different client configuration.
    let expectedToken: string | null = null;
    if (callback) {
      const tokenHash = param("token_hash");
      if (tokenHash) {
        // Custom templates can target /login or /auth/confirm. A failed or
        // sessionless verification must never fall back to a previously logged-in user.
        if ((type !== "email" && type !== "signup") || param("access_token") || param("refresh_token")) return fail();
        const { data: confirmation, error: confirmationError } = await client.auth.verifyOtp({ token_hash: tokenHash, type });
        if (confirmationError || !confirmation.session?.access_token) return fail();
        expectedToken = confirmation.session.access_token;
      } else {
        if (!param("access_token") || !param("refresh_token")) return fail();
        expectedToken = param("access_token");
      }
    }
    const { data, error } = await client.auth.getSession();
    const session = data.session;
    if (error) return fail();
    if (!session) return callback ? fail() : { authenticated: false, message: "" };
    if (expectedToken && session.access_token !== expectedToken) return fail();
    const verified = await client.auth.getUser();
    if (verified.error || !verified.data.user?.email_confirmed_at
      || verified.data.user.id !== session.user.id
      || !session.access_token || !session.expires_at || session.expires_at * 1000 <= Date.now()) return fail();
    return { authenticated: true, message: "" };
  } catch { return fail(); }
}
