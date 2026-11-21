import { createClient } from "@supabase/supabase-js";

export const resetPath = "/redefinir-senha";
export const recoveryLinkError = "Este link é inválido, expirou ou já foi usado. Solicite um novo link.";
export const recoveryRequestMessage = "Se houver uma conta com esse e-mail, você receberá um link para redefinir a senha.";

export function recoveryRedirect(origin: string, configuredOrigin = process.env.NEXT_PUBLIC_SITE_URL) {
  const approved = new URL(configuredOrigin ?? origin);
  const local = !configuredOrigin && process.env.NODE_ENV === "development" &&
    ["localhost", "127.0.0.1", "[::1]"].includes(approved.hostname);
  if (approved.origin !== origin || approved.username || approved.password ||
    approved.pathname !== "/" || approved.search || approved.hash ||
    (!local && (!configuredOrigin || approved.protocol !== "https:"))) {
    throw new Error("Password recovery origin not configured");
  }
  return new URL(resetPath, approved.origin).href;
}

export function recoveryToken(fragment: string) {
  const params = new URLSearchParams(fragment.slice(1));
  const tokens = params.getAll("token_hash");
  return tokens.length === 1 && /^[A-Za-z0-9_-]{16,512}$/.test(tokens[0]) ? tokens[0] : null;
}

export function createRecoveryAuth() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new Error("Password recovery unavailable");
  return createClient(new URL(url).origin, key, {
    auth: {
      storageKey: "bandup-password-recovery",
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  }).auth;
}

export async function requestPasswordRecovery(email: string, origin: string) {
  const redirectTo = recoveryRedirect(origin);
  const auth = createRecoveryAuth();
  try {
    await auth.resetPasswordForEmail(email, { redirectTo });
  } catch {
    // API errors can vary by account. Keep the request response uniform.
  } finally {
    await auth.dispose();
  }
  return recoveryRequestMessage;
}
