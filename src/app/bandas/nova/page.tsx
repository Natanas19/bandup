"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { User } from "@supabase/supabase-js";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { createBandSlug } from "@/lib/band-slug";
import { requiredTextError } from "@/lib/form-validation";
import BandPhotoPicker from "@/components/band-photo-picker";
import { bandPhotoSession, BandLogoError, uploadBandLogo } from "@/lib/band-logo-upload";
import { ensureCreatedBand, type BandCreationAttempt } from "@/lib/band-creation";

export default function NewBandPage() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [isCheckingSession, setIsCheckingSession] = useState(true);
  const [isCreating, setIsCreating] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [photo, setPhoto] = useState<File | null>(null);
  const [createdBand, setCreatedBand] = useState<string | null>(null);
  const [blocked, setBlocked] = useState(false);
  const operation = useRef<AbortController | null>(null);
  const busy = useRef(false);
  const identity = useRef<string | null>(null);
  const attempt = useRef<BandCreationAttempt | null>(null);
  const created = useRef<string | null>(null);
  const photoAttempt = useRef<string | null>(null);

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

        identity.current = data.user.id;
        setUser(data.user);
      } catch {
        if (isMounted) router.replace("/login");
      } finally {
        if (isMounted) setIsCheckingSession(false);
      }
    }

    const { data: subscription } = getSupabaseBrowserClient().auth.onAuthStateChange((_event, session) => {
      if (identity.current && session?.user.id !== identity.current) {
        operation.current?.abort(); setBlocked(true); setPhoto(null);
        setErrorMessage("Sua conta mudou. Atualize a página antes de continuar.");
      }
    });
    void checkSession();
    return () => {
      isMounted = false;
      operation.current?.abort();
      subscription.subscription.unsubscribe();
    };
  }, [router]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy.current || blocked) return;

    setErrorMessage("");
    const normalizedName = name.trim();
    const nameError = requiredTextError(normalizedName, "o nome da banda");
    if (nameError) {
      setErrorMessage(nameError);
      return;
    }
    if (normalizedName.length > 100 || description.length > 500) {
      setErrorMessage("Confira os limites do nome e da descrição."); return;
    }
    busy.current = true; setIsCreating(true);
    const controller = new AbortController(); operation.current = controller;
    const timeout = window.setTimeout(() => controller.abort(), 45000);

    try {
      const supabase = getSupabaseBrowserClient();
      const { data: authData, error: authError } = await supabase.auth.getUser();

      if (authError || !authData.user || !user || authData.user.id !== user.id || controller.signal.aborted) {
        router.replace("/login");
        return;
      }

      const { scoped, verify } = await bandPhotoSession(supabase, user.id, controller.signal);
      if (!created.current) {
        attempt.current ??= { slug: createBandSlug(normalizedName), sent: false };
        created.current = await ensureCreatedBand(scoped, attempt.current, normalizedName, description.trim());
      }
      if (controller.signal.aborted) throw new BandLogoError("authorization");
      setCreatedBand(created.current);
      await verify();
      if (photo) {
        photoAttempt.current ??= crypto.randomUUID();
        await uploadBandLogo(supabase, user.id, created.current, photo, photoAttempt.current, controller.signal);
      }
      if (controller.signal.aborted) return;
      setPhoto(null);
      router.replace("/dashboard");
      router.refresh();
    } catch (error) {
      if (controller.signal.aborted) {
        setErrorMessage("Operação interrompida. Confira a banda criada antes de continuar; a tentativa será recuperada sem duplicar a banda.");
      } else if (error instanceof BandLogoError && error.stage === "authorization") {
        setBlocked(true); setErrorMessage("Sua sessão ou permissão mudou. Atualize a página para continuar.");
      } else {
        setErrorMessage(created.current
          ? "Banda criada; não foi possível confirmar a foto. Tente novamente ou continue sem foto."
          : "Não foi possível criar a banda ou confirmar a resposta. Tente novamente para recuperar a mesma tentativa.");
      }
    } finally {
      window.clearTimeout(timeout);
      if (operation.current === controller) operation.current = null;
      busy.current = false;
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
                disabled={isCreating || blocked || !!createdBand || !!attempt.current?.sent}
                maxLength={100}
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Ex.: Os Ensaios"
                className="w-full rounded-xl border border-outline bg-surface px-4 py-3 text-base md:text-sm text-content outline-none transition placeholder:text-content-faint focus:border-input-focus focus:ring-4 focus:ring-input-ring"
              />
              <p aria-live="polite" className="mt-2 text-right text-xs text-content-muted">
                {name.length}/100 caracteres
              </p>
            </div>

            <div>
              <label htmlFor="band-description" className="mb-2 block text-sm font-medium text-content-label">
                Descrição <span className="font-normal text-content-faint">(opcional)</span>
              </label>
              <textarea
                id="band-description"
                name="description"
                rows={4}
                disabled={isCreating || blocked || !!createdBand || !!attempt.current?.sent}
                maxLength={500}
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="Conte um pouco sobre a banda"
                className="w-full resize-y rounded-xl border border-outline bg-surface px-4 py-3 text-base md:text-sm text-content outline-none transition placeholder:text-content-faint focus:border-input-focus focus:ring-4 focus:ring-input-ring"
              />
              <p aria-live="polite" className="mt-2 text-right text-xs text-content-muted">
                {description.length}/500 caracteres
              </p>
            </div>

            <BandPhotoPicker file={photo} disabled={isCreating || blocked} onChange={file => {
              if (busy.current || blocked) return;
              photoAttempt.current = null; setPhoto(file);
            }} />
            {createdBand && <p role="status" className="text-sm text-content-muted">Banda criada. A foto é opcional.</p>}
            {createdBand && <button type="button" disabled={isCreating || blocked}
              className="text-sm font-semibold text-accent" onClick={() => { setPhoto(null); router.replace("/dashboard"); router.refresh(); }}>Continuar sem foto</button>}
            {errorMessage && (
              <p role="alert" className="rounded-xl border border-danger-border bg-danger-surface px-4 py-3 text-sm leading-5 text-danger">
                {errorMessage}
              </p>
            )}

            <button
              type="submit"
              disabled={isCreating || blocked}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3.5 text-sm font-semibold text-on-primary shadow-lg shadow-primary/20 transition hover:bg-primary-hover focus:outline-none focus:ring-4 focus:ring-focus disabled:cursor-not-allowed disabled:opacity-70"
            >
              {isCreating ? "Salvando banda..." : createdBand ? photo ? "Tentar salvar foto" : "Continuar" : "Criar banda"}
            </button>
          </form>
        ) : null}
      </section>
    </main>
  );
}
