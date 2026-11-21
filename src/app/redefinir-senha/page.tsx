"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import PasswordInput from "@/components/password-input";
import { createRecoveryAuth, recoveryLinkError, recoveryRedirect, recoveryToken, resetPath } from "@/lib/password-recovery";

type RecoveryAuth = ReturnType<typeof createRecoveryAuth>;
type RecoverySession = { auth: RecoveryAuth; userId: string };

async function endRecovery(auth: RecoveryAuth) {
  try { await auth.signOut({ scope: "local" }); }
  finally { await auth.dispose(); }
}

export default function ResetPasswordPage() {
  const router = useRouter();
  const token = useRef<string | null | undefined>(undefined);
  const session = useRef<RecoverySession | null>(null);
  const active = useRef(false);
  const saving = useRef(false);
  const [phase, setPhase] = useState<"loading" | "confirm" | "verifying" | "ready" | "invalid" | "done">("loading");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    active.current = true;
    if (token.current === undefined) {
      const { hash, search } = window.location;
      token.current = recoveryToken(hash);
      if (hash || search) window.history.replaceState(window.history.state, "", resetPath);
      setPhase(token.current ? "confirm" : "invalid");
    }
    return () => {
      active.current = false;
      const current = session.current;
      session.current = null;
      if (current) void endRecovery(current.auth).catch(() => {});
    };
  }, []);

  async function confirmLink() {
    const hash = token.current;
    if (!hash) return;
    token.current = null;
    setPhase("verifying");
    let auth: RecoveryAuth | undefined;
    try {
      recoveryRedirect(window.location.origin);
      auth = createRecoveryAuth();
      const { data, error: failure } = await auth.verifyOtp({ token_hash: hash, type: "recovery" });
      if (failure || !data.user || !data.session?.access_token || data.session.user.id !== data.user.id || !active.current) {
        if (active.current) setPhase("invalid");
        return;
      }
      session.current = { auth, userId: data.user.id };
      setPhase("ready");
    } catch {
      if (active.current) setPhase("invalid");
    } finally {
      if (auth && session.current?.auth !== auth) void endRecovery(auth).catch(() => {});
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const current = session.current;
    if (!current || saving.current) return;
    if (password.length < 8 || password !== confirmation) {
      setError(password.length < 8 ? "Use pelo menos oito caracteres." : "As senhas precisam ser iguais.");
      return;
    }
    saving.current = true;
    setBusy(true);
    setError("");
    try {
      const { data, error: failure } = await current.auth.updateUser({ password });
      if (session.current !== current) return;
      if (failure || data.user?.id !== current.userId) {
        if (failure && [401, 403].includes(failure.status ?? 0)) {
          session.current = null;
          void endRecovery(current.auth).catch(() => {});
          setPhase("invalid");
          return;
        }
        setError("Não foi possível redefinir a senha. Confira a nova senha ou solicite um novo link.");
        return;
      }
      session.current = null;
      setPassword("");
      setConfirmation("");
      setPhase("done");
      await endRecovery(current.auth).catch(() => {});
      if (active.current) router.replace("/login");
    } catch {
      if (active.current) setError("Não foi possível confirmar a redefinição. Tente entrar com a nova senha ou solicite outro link.");
    } finally {
      saving.current = false;
      if (active.current) setBusy(false);
    }
  }

  const inputClass = "w-full rounded-control border border-outline bg-surface px-4 py-3 text-base text-content focus:outline-none focus:ring-4 focus:ring-input-ring";
  const primaryClass = "min-h-11 w-full rounded-control bg-primary px-4 py-2 font-semibold text-on-primary hover:bg-primary-hover focus-visible:ring-4 focus-visible:ring-focus disabled:opacity-60";
  return <main className="flex flex-1 items-center justify-center px-4 py-8">
    <section className="w-full max-w-md space-y-4 rounded-panel border border-outline bg-surface p-6 shadow-app-panel">
      <h1 className="text-2xl font-semibold text-content">Redefinir senha</h1>
      {phase === "loading" && <p role="status">Verificando o link…</p>}
      {phase === "confirm" && <button type="button" className={primaryClass} onClick={confirmLink}>Confirmar link de recuperação</button>}
      {phase === "verifying" && <p role="status">Validando o link…</p>}
      {phase === "invalid" && <p role="alert" className="text-sm text-danger">{recoveryLinkError}</p>}
      {phase === "done" && <p role="status">Senha redefinida.</p>}
      {phase === "ready" && <form onSubmit={submit} className="space-y-4">
        <div>
          <label htmlFor="recovery-password" className="mb-2 block text-sm font-medium text-content-label">Nova senha</label>
          <PasswordInput id="recovery-password" name="password" autoComplete="new-password" required minLength={8}
            disabled={busy} className={inputClass} value={password} onChange={event => setPassword(event.target.value)} />
        </div>
        <div>
          <label htmlFor="recovery-confirmation" className="mb-2 block text-sm font-medium text-content-label">Confirmar nova senha</label>
          <PasswordInput id="recovery-confirmation" name="confirmation" visibilityLabel="confirmação de senha"
            autoComplete="new-password" required minLength={8} disabled={busy} className={inputClass}
            value={confirmation} onChange={event => setConfirmation(event.target.value)} />
        </div>
        {error && <p role="alert" className="text-sm text-danger">{error}</p>}
        <button type="submit" className={primaryClass} disabled={busy}>{busy ? "Salvando…" : "Salvar nova senha"}</button>
      </form>}
      {phase !== "done" && <Link href="/esqueci-minha-senha" className="inline-flex min-h-11 items-center rounded-control text-sm font-semibold text-brand underline focus-visible:ring-4 focus-visible:ring-focus">Solicitar novo link</Link>}
      {phase === "done" && <Link href="/login" className="inline-flex min-h-11 items-center rounded-control text-sm font-semibold text-brand underline focus-visible:ring-4 focus-visible:ring-focus">Voltar ao login</Link>}
    </section>
  </main>;
}
