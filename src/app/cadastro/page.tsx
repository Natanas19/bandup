"use client";

import { useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import PasswordInput from "@/components/password-input";
import { useRouter } from "next/navigation";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

import { normalizeDisplayName } from "@/lib/display-name";

const emailPattern = String.raw`[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+`;

function emailValidationMessage(value: string) {
  if (!value.trim()) return "Informe seu e-mail.";
  return new RegExp(`^${emailPattern}$`).test(value.trim())
    ? ""
    : "Informe um e-mail válido, como voce@exemplo.com.";
}

export default function CadastroPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isSubmitted, setIsSubmitted] = useState(false);
  const submitting = useRef(false);
  const [displayName, setDisplayName] = useState("");
  const [emailError, setEmailError] = useState("");

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current) return;
    setError("");
    const normalizedName = normalizeDisplayName(displayName);
    if (!normalizedName) {
      setError("Informe um nome de exibição de até 80 caracteres, sem e-mail ou caracteres de controle.");
      return;
    }
    const normalizedEmail = email.trim();
    const validationMessage = emailValidationMessage(normalizedEmail);
    setEmail(normalizedEmail);
    setEmailError(validationMessage);
    if (validationMessage) {
      setError(validationMessage);
      return;
    }
    if (password.length < 8) {
      setError("Use uma senha com pelo menos 8 caracteres.");
      return;
    }
    if (password !== confirmation) {
      setError("As senhas precisam ser iguais.");
      return;
    }
    submitting.current = true;
    setIsLoading(true);
    try {
      const { data, error: signUpError } = await getSupabaseBrowserClient().auth.signUp({
        email: normalizedEmail,
        password,
        options: { data: { display_name: normalizedName }, emailRedirectTo: `${window.location.origin}/login` },
      });
      // Duplicate accounts receive the same neutral response as confirmation-required
      // signups. Never display Auth's raw messages or inspect returned identities.
      if (signUpError && !["user_already_exists", "email_exists"].includes(signUpError.code ?? "")) {
        setError("Não foi possível concluir a solicitação. Tente novamente em instantes ou acesse o login.");
        return;
      }
      setPassword("");
      setConfirmation("");
      if (!signUpError && data.session) {
        router.replace("/dashboard");
        return;
      }
      setIsSubmitted(true);
    } catch {
      setError("Não foi possível conectar ao serviço de cadastro. Tente novamente em instantes.");
    } finally {
      submitting.current = false;
      setIsLoading(false);
    }
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
                <p className="text-sm font-semibold text-accent">Sua conta pessoal no BandUp</p>
                <h2 className="mt-2 text-3xl font-semibold tracking-tight text-content">
                  Criar sua conta
                </h2>
                <p className="mt-2 text-sm leading-6 text-content-subtle">
                  Comece com sua conta pessoal. Você pode criar e participar de várias bandas.
                </p>
              </div>

              {isSubmitted ? (
                <div role="status" className="rounded-xl border border-accent-border bg-accent-soft p-5 text-sm leading-6 text-content">
                  <h3 className="font-semibold">Confira seu e-mail</h3>
                  <p className="mt-2">Se o cadastro puder ser concluído com este e-mail, você receberá as instruções de confirmação. Você precisa ter acesso ao e-mail cadastrado. Confira a caixa de entrada e o spam e abra o link mais recente. Após uma confirmação válida, sua sessão será verificada para abrir o dashboard automaticamente. Se a sessão não for iniciada ou você já possui uma conta, acesse o login.</p>
                </div>
              ) : <form onSubmit={handleSubmit} className="space-y-5">
                <div>
                  <label htmlFor="display-name" className="mb-2 block text-sm font-medium text-content-label">Nome de exibição</label>
                  <input id="display-name" name="displayName" type="text" autoComplete="nickname" required maxLength={80}
                    value={displayName} onChange={event => setDisplayName(event.target.value)} aria-describedby="display-name-help"
                    className="w-full min-w-0 rounded-xl border border-outline bg-surface px-4 py-3 text-base text-content outline-none focus:border-input-focus focus:ring-4 focus:ring-input-ring" />
                  <p id="display-name-help" className="mt-2 text-xs text-content-muted">Como deseja se apresentar às bandas. Não use seu e-mail.</p>
                </div>
                <div>
                  <label htmlFor="email" className="mb-2 block text-sm font-medium text-content-label">
                    E-mail
                  </label>
                  <input
                    id="email"
                    name="email"
                    type="email"
                    inputMode="email"
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    pattern={emailPattern}
                    autoComplete="email"
                    required
                    value={email}
                    onChange={(event) => {
                      event.currentTarget.setCustomValidity("");
                      setEmail(event.target.value.trim());
                      setEmailError("");
                    }}
                    onBlur={(event) => {
                      const message = emailValidationMessage(event.currentTarget.value);
                      setEmail(event.currentTarget.value.trim());
                      setEmailError(message);
                    }}
                    onInvalid={(event) => {
                      const message = emailValidationMessage(event.currentTarget.value)
                        || "Informe um e-mail válido, como voce@exemplo.com.";
                      event.currentTarget.setCustomValidity(message);
                      setEmailError(message);
                    }}
                    placeholder="voce@exemplo.com"
                    aria-invalid={Boolean(emailError)}
                    aria-describedby={emailError ? "signup-email-help signup-email-error" : "signup-email-help"}
                    className="w-full rounded-xl border border-outline bg-surface px-4 py-3 text-base md:text-sm text-content outline-none transition placeholder:text-content-faint focus:border-input-focus focus:ring-4 focus:ring-input-ring"
                  />
                  {emailError && <p id="signup-email-error" role="alert" className="mt-2 text-sm text-danger">{emailError}</p>}
                  <p id="signup-email-help" className="mt-2 text-xs text-content-muted">Use um e-mail ao qual você tenha acesso. Você precisará abrir o link de confirmação recebido nele.</p>
                </div>

                <div>
                  <label htmlFor="password" className="mb-2 block text-sm font-medium text-content-label">
                    Senha
                  </label>
                  <PasswordInput
                    id="password"
                    name="password"
                    autoComplete="new-password"
                    minLength={8}
                    required
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    placeholder="Pelo menos 8 caracteres"
                    className="w-full rounded-xl border border-outline bg-surface px-4 py-3 text-base md:text-sm text-content outline-none transition placeholder:text-content-faint focus:border-input-focus focus:ring-4 focus:ring-input-ring"
                  />
                </div>

                <div>
                  <label htmlFor="confirmation" className="mb-2 block text-sm font-medium text-content-label">Confirme sua senha</label>
                  <PasswordInput id="confirmation" name="confirmation" visibilityLabel="confirmação de senha" autoComplete="new-password"
                    required minLength={8} value={confirmation} onChange={(event) => setConfirmation(event.target.value)}
                    className="w-full rounded-xl border border-outline bg-surface px-4 py-3 text-base md:text-sm text-content outline-none transition focus:border-input-focus focus:ring-4 focus:ring-input-ring" />
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
                  {isLoading ? "Criando conta..." : "Criar conta"}
                </button>
              </form>}

              <p className="mt-8 text-center text-xs leading-5 text-content-faint">
                Já possui uma conta? <Link href="/login" className="font-semibold text-accent underline focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-focus">Ir para o login</Link>
              </p>
            </div>
          </section>
        </div>
      </main>
    </>
  );
}
