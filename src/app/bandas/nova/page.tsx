"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { User } from "@supabase/supabase-js";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { createBandSlug } from "@/lib/band-slug";
import { requiredTextError } from "@/lib/form-validation";

export default function NewBandPage() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [isCheckingSession, setIsCheckingSession] = useState(true);
  const [isCreating, setIsCreating] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    let isMounted = true;

    async function checkSession() {
      try {
        const { data, error } = await getSupabaseBrowserClient().auth.getUser();
        if (!isMounted) return;

        if (error || !data.user) {
          router.replace("/login");
          return;
        }

        setUser(data.user);
      } catch {
        if (isMounted) router.replace("/login");
      } finally {
        if (isMounted) setIsCheckingSession(false);
      }
    }

    void checkSession();
    return () => {
      isMounted = false;
    };
  }, [router]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isCreating) return;

    setErrorMessage("");
    const normalizedName = name.trim();
    const nameError = requiredTextError(normalizedName, "o nome da banda");
    if (nameError) {
      setErrorMessage(nameError);
      return;
    }
    setIsCreating(true);

    try {
      const supabase = getSupabaseBrowserClient();
      const { data: authData, error: authError } = await supabase.auth.getUser();

      if (authError || !authData.user || !user) {
        router.replace("/login");
        return;
      }

      const { error } = await supabase.from("bands").insert({
        name: normalizedName,
        slug: createBandSlug(normalizedName),
        description: description.trim() || null,
      });

      if (error) {
        setErrorMessage("Não foi possível criar a banda. Confira os dados e tente novamente.");
        return;
      }

      router.replace("/dashboard");
    } catch {
      setErrorMessage("Não foi possível criar a banda agora. Tente novamente.");
    } finally {
      setIsCreating(false);
    }
  }

  return (
    <main className="flex flex-1 items-center justify-center px-6 py-16">
      <section className="w-full max-w-xl rounded-3xl border border-nav-border bg-surface p-8 shadow-app-dashboard sm:p-12">
        <Link href="/dashboard" className="text-sm font-semibold text-accent hover:text-accent-hover focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-focus">
          ← Voltar ao dashboard
        </Link>
        <div className="mt-8">
          <p className="text-sm font-semibold tracking-widest text-accent uppercase">BandUp</p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight text-content">Crie sua banda</h1>
          <p className="mt-3 text-sm leading-6 text-content-muted">
            Reúna sua banda no BandUp e comece a organizar tudo em um só lugar.
          </p>
        </div>

        {isCheckingSession ? (
          <p className="mt-8 text-sm text-content-muted">Verificando sua sessão...</p>
        ) : user ? (
          <form onSubmit={handleSubmit} className="mt-8 space-y-5">
            <div>
              <label htmlFor="band-name" className="mb-2 block text-sm font-medium text-content-label">
                Nome da banda
              </label>
              <input
                id="band-name"
                name="name"
                type="text"
                required
                maxLength={100}
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Ex.: Os Ensaios"
                className="w-full rounded-xl border border-outline bg-surface px-4 py-3 text-base md:text-sm text-content outline-none transition placeholder:text-content-faint focus:border-input-focus focus:ring-4 focus:ring-input-ring"
              />
            </div>

            <div>
              <label htmlFor="band-description" className="mb-2 block text-sm font-medium text-content-label">
                Descrição <span className="font-normal text-content-faint">(opcional)</span>
              </label>
              <textarea
                id="band-description"
                name="description"
                rows={4}
                maxLength={500}
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="Conte um pouco sobre a banda"
                className="w-full resize-y rounded-xl border border-outline bg-surface px-4 py-3 text-base md:text-sm text-content outline-none transition placeholder:text-content-faint focus:border-input-focus focus:ring-4 focus:ring-input-ring"
              />
            </div>

            {errorMessage && (
              <p role="alert" className="rounded-xl border border-danger-border bg-danger-surface px-4 py-3 text-sm leading-5 text-danger">
                {errorMessage}
              </p>
            )}

            <button
              type="submit"
              disabled={isCreating}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3.5 text-sm font-semibold text-on-primary shadow-lg shadow-primary/20 transition hover:bg-primary-hover focus:outline-none focus:ring-4 focus:ring-focus disabled:cursor-not-allowed disabled:opacity-70"
            >
              {isCreating ? "Criando banda..." : "Criar banda"}
            </button>
          </form>
        ) : null}
      </section>
    </main>
  );
}
