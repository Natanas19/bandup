"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import PasswordInput from "@/components/password-input";
import { useRouter } from "next/navigation";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

import { isAuthReturn, resolveLoginSession, sessionFailure, type LoginSessionResult } from "@/lib/email-confirmation";

function getFriendlyError(message: string) {
  if (message.toLowerCase().includes("invalid login credentials")) {
    return "E-mail ou senha incorretos. Confira seus dados e tente novamente.";
  }

  if (message.toLowerCase().includes("email not confirmed")) {
    return "Confirme seu e-mail antes de entrar. Você precisa ter acesso ao e-mail cadastrado: confira a caixa de entrada e o spam e abra o link mais recente.";
  }

  return "Não foi possível entrar agora. Tente novamente em instantes.";
}

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isCheckingSession, setIsCheckingSession] = useState(true);

  const sessionCheck = useRef<Promise<LoginSessionResult> | null>(null);

  useEffect(() => {
    let active = true;
    const url = new URL(window.location.href);
    const callback = isAuthReturn(url);
    const timeout = window.setTimeout(() => {
      if (!active) return;
      active = false;
      setError(sessionFailure);
      setIsCheckingSession(false);
      if (callback) window.history.replaceState(window.history.state, "", "/login");
    }, 15000);
    // Preserve the same promise across StrictMode effect replays, after the SDK
    // has consumed the URL. Never retry a single-use confirmation token.
    sessionCheck.current ??= (async () => {
      try { return await resolveLoginSession(getSupabaseBrowserClient(), url); }
      catch { return { authenticated: false, message: sessionFailure }; }
    })();
    void sessionCheck.current.then(result => {
      if (!active) return;
      window.clearTimeout(timeout);
      if (callback) window.history.replaceState(window.history.state, "", "/login");
      if (result.authenticated) { router.replace("/dashboard"); return; }
      setError(result.message);
      setIsCheckingSession(false);
    });
    return () => { active = false; window.clearTimeout(timeout); };
  }, [router]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setIsLoading(true);

    try {
      const supabase = getSupabaseBrowserClient();
      const { data, error: signInError } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });

      if (signInError) {
        setError(getFriendlyError(signInError.message));
        return;
      }

      if (!data.session) {
        setError("Não foi possível iniciar uma sessão. Tente novamente.");
        return;
      }

      router.replace("/dashboard");
    } catch {
      setError("Não foi possível conectar ao serviço de login. Tente novamente.");
    } finally {
      setIsLoading(false);
    }
  }

  if (isCheckingSession) {
    return (
      <>
      <main className="flex flex-1 items-center justify-center px-4 py-6 sm:px-8 sm:py-12">
          <p role="status" className="text-sm text-content-muted">Verificando sua confirmação e sessão...</p>
      </main>
    </>
    );
  }

  return (
    <>
      <main className="flex flex-1 items-center justify-center px-4 py-6 sm:px-8 sm:py-12">
        <div className="grid w-full max-w-5xl overflow-hidden rounded-[2rem] bg-surface shadow-app-panel md:grid-cols-[0.9fr_1.1fr]">
          <section className="relative flex flex-col sm:min-h-64 justify-between overflow-hidden bg-gradient-to-br from-violet-700 via-violet-800 to-indigo-950 p-6 text-white sm:p-10 md:min-h-[600px]">
            <div aria-hidden="true" className="absolute -right-20 -top-24 h-72 w-72 rounded-full border border-white/15" />
            <div aria-hidden="true" className="absolute -bottom-28 -left-24 h-80 w-80 rounded-full border border-white/15" />
            <Link href="/" className="relative rounded text-xl font-bold tracking-tight focus:outline-none focus:ring-4 focus:ring-violet-200">
              Band<span className="text-violet-300">Up</span>
            </Link>
            <div className="relative mt-5 sm:mt-12 md:mt-0">
              <p className="text-sm font-semibold tracking-[0.2em] text-violet-200 uppercase">
                Sua música começa aqui
              </p>
              <h1 className="mt-3 max-w-sm text-3xl sm:mt-4 font-semibold leading-tight tracking-tight sm:text-5xl">
                Sua banda, em sintonia.
              </h1>
              <p className="mt-3 max-w-sm text-base sm:mt-5 leading-7 text-login-secondary">
                Um espaço para sua banda crescer e fazer acontecer.
              </p>
            </div>
            <p className="relative mt-5 text-sm text-login-caption sm:mt-12">
              Feito para quem vive música.
            </p>
          </section>

          <section className="flex items-center justify-center px-5 py-7 sm:px-12 sm:py-12 md:px-14">
            <div className="w-full max-w-md">
              <div className="mb-9">
                <p className="text-sm font-semibold text-accent">Bem-vindo de volta</p>
                <h2 className="mt-2 text-3xl font-semibold tracking-tight text-content">
                  Entrar na sua conta
                </h2>
                <p className="mt-2 text-sm leading-6 text-content-subtle">
                  Acesse seu espaço no BandUp com seu e-mail e senha.
                </p>
              </div>

              <form onSubmit={handleSubmit} className="space-y-5">
                <div>
                  <label htmlFor="email" className="mb-2 block text-sm font-medium text-content-label">
                    E-mail
                  </label>
                  <input
                    id="email"
                    name="email"
                    type="email"
                    autoComplete="email"
                    required
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    placeholder="voce@exemplo.com"
                    className="w-full rounded-xl border border-outline bg-surface px-4 py-3 text-base md:text-sm text-content outline-none transition placeholder:text-content-faint focus:border-input-focus focus:ring-4 focus:ring-input-ring"
                  />
                </div>

                <div>
                  <label htmlFor="password" className="mb-2 block text-sm font-medium text-content-label">
                    Senha
                  </label>
                  <PasswordInput
                    id="password"
                    name="password"
                    autoComplete="current-password"
                    required
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    placeholder="Sua senha"
                    className="w-full rounded-xl border border-outline bg-surface px-4 py-3 text-base md:text-sm text-content outline-none transition placeholder:text-content-faint focus:border-input-focus focus:ring-4 focus:ring-input-ring"
                  />
                  <Link href="/esqueci-minha-senha" className="mt-1 inline-flex min-h-11 items-center rounded-control text-sm font-semibold text-brand underline focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-focus">
                    Esqueci minha senha?
                  </Link>
                </div>

                {error && (
                  <p role="alert" className="rounded-xl border border-danger-border bg-danger-surface px-4 py-3 text-sm leading-5 text-danger">
                    {error}
                  </p>
                )}

                <button
                  type="submit"
                  disabled={isLoading}
                  className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3.5 text-sm font-semibold text-on-primary shadow-lg shadow-primary/20 transition hover:bg-primary-hover focus:outline-none focus:ring-4 focus:ring-focus disabled:cursor-not-allowed disabled:opacity-70"
                >
                  {isLoading && (
                    <span aria-hidden="true" className="h-4 w-4 animate-spin rounded-full border-2 border-on-primary/40 border-t-on-primary motion-reduce:animate-none" />
                  )}
                  {isLoading ? "Entrando..." : "Entrar"}
                </button>
              </form>

              <p className="mt-8 text-center text-xs leading-5 text-content-faint">
                Ainda não tem conta? <Link href="/cadastro" className="font-semibold text-accent underline focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-focus">Criar minha conta</Link>
              </p>
            </div>
          </section>
        </div>
      </main>
    </>
  );
}
