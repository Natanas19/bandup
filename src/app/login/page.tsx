"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

function getFriendlyError(message: string) {
  if (message.toLowerCase().includes("invalid login credentials")) {
    return "E-mail ou senha incorretos. Confira seus dados e tente novamente.";
  }

  if (message.toLowerCase().includes("email not confirmed")) {
    return "Confirme seu e-mail antes de entrar.";
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

  useEffect(() => {
    let isMounted = true;
    let authStateChanged = false;
    const supabase = getSupabaseBrowserClient();
    const { data: authListener } = supabase.auth.onAuthStateChange((event, session) => {
      authStateChanged = true;
      if (!isMounted) return;

      if (session) {
        router.replace("/dashboard");
      } else if (event === "INITIAL_SESSION" || event === "SIGNED_OUT") {
        setIsCheckingSession(false);
      }
    });

    void supabase.auth.getSession().then(({ data, error: sessionError }) => {
      if (!isMounted || authStateChanged) return;

      if (sessionError) {
        setError("Não foi possível verificar sua sessão. Tente novamente.");
        setIsCheckingSession(false);
        return;
      }

      if (data.session) {
        router.replace("/dashboard");
        return;
      }

      setIsCheckingSession(false);
    }).catch(() => {
      if (!isMounted || authStateChanged) return;
      setError("Não foi possível verificar sua sessão. Tente novamente.");
      setIsCheckingSession(false);
    });

    return () => {
      isMounted = false;
      authListener.subscription.unsubscribe();
    };
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
      <main className="flex flex-1 items-center justify-center px-5 py-12 sm:px-8">
        <p role="status" className="text-sm text-zinc-600">Verificando sua sessão...</p>
      </main>
    );
  }

  return (
    <main className="flex flex-1 items-center justify-center px-5 py-12 sm:px-8">
      <div className="grid w-full max-w-5xl overflow-hidden rounded-[2rem] bg-white shadow-[0_24px_80px_-32px_rgba(54,36,104,0.3)] md:grid-cols-[0.9fr_1.1fr]">
        <section className="relative flex min-h-64 flex-col justify-between overflow-hidden bg-gradient-to-br from-violet-700 via-violet-800 to-indigo-950 p-8 text-white sm:p-10 md:min-h-[600px]">
          <div aria-hidden="true" className="absolute -right-20 -top-24 h-72 w-72 rounded-full border border-white/15" />
          <div aria-hidden="true" className="absolute -bottom-28 -left-24 h-80 w-80 rounded-full border border-white/15" />
          <Link href="/" className="relative text-xl font-bold tracking-tight">
            Band<span className="text-violet-300">Up</span>
          </Link>
          <div className="relative mt-12 md:mt-0">
            <p className="text-sm font-semibold tracking-[0.2em] text-violet-200 uppercase">
              Sua música começa aqui
            </p>
            <h1 className="mt-4 max-w-sm text-4xl font-semibold leading-tight tracking-tight sm:text-5xl">
              Sua banda, em sintonia.
            </h1>
            <p className="mt-5 max-w-sm text-base leading-7 text-violet-100/80">
              Um espaço para sua banda crescer e fazer acontecer.
            </p>
          </div>
          <p className="relative mt-12 text-sm text-violet-200/75">
            Feito para quem vive música.
          </p>
        </section>

        <section className="flex items-center justify-center px-6 py-12 sm:px-12 md:px-14">
          <div className="w-full max-w-md">
            <div className="mb-9">
              <p className="text-sm font-semibold text-violet-700">Bem-vindo de volta</p>
              <h2 className="mt-2 text-3xl font-semibold tracking-tight text-zinc-900">
                Entrar na sua conta
              </h2>
              <p className="mt-2 text-sm leading-6 text-zinc-500">
                Acesse seu espaço no BandUp com seu e-mail e senha.
              </p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-5">
              <div>
                <label htmlFor="email" className="mb-2 block text-sm font-medium text-zinc-700">
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
                  className="w-full rounded-xl border border-zinc-200 bg-white px-4 py-3 text-sm text-zinc-900 outline-none transition placeholder:text-zinc-400 focus:border-violet-500 focus:ring-4 focus:ring-violet-100"
                />
              </div>

              <div>
                <label htmlFor="password" className="mb-2 block text-sm font-medium text-zinc-700">
                  Senha
                </label>
                <input
                  id="password"
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="Sua senha"
                  className="w-full rounded-xl border border-zinc-200 bg-white px-4 py-3 text-sm text-zinc-900 outline-none transition placeholder:text-zinc-400 focus:border-violet-500 focus:ring-4 focus:ring-violet-100"
                />
              </div>

              {error && (
                <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm leading-5 text-red-700">
                  {error}
                </p>
              )}

              <button
                type="submit"
                disabled={isLoading}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-violet-700 px-4 py-3.5 text-sm font-semibold text-white shadow-lg shadow-violet-700/20 transition hover:bg-violet-800 focus:outline-none focus:ring-4 focus:ring-violet-200 disabled:cursor-not-allowed disabled:opacity-70"
              >
                {isLoading && (
                  <span aria-hidden="true" className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                )}
                {isLoading ? "Entrando..." : "Entrar"}
              </button>
            </form>

            <p className="mt-8 text-center text-xs leading-5 text-zinc-400">
              Acesse com as credenciais da sua conta BandUp.
            </p>
          </div>
        </section>
      </div>
    </main>
  );
}
