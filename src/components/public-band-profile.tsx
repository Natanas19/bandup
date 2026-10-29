"use client";

import { useState } from "react";
import Image from "next/image";
import SocialPlatformIcon from "@/components/social-platform-icon";
import { LinkifiedText } from "@/components/linkified-text";
import type { PublicBand } from "@/lib/public-band-data";
import { getSafeExternalUrl, socialPlatforms } from "@/lib/social-links";

export default function PublicBandProfile({ band }: { band: PublicBand }) {
  const [failedImage, setFailedImage] = useState("");
  const visibleLinks = band.links.filter((link) => getSafeExternalUrl(link.url));
  return (
    <main className="relative isolate min-w-0 flex-1 overflow-hidden px-4 py-10 sm:px-6 sm:py-16">
      <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-96 bg-gradient-to-b from-decorative-start via-decorative-end to-transparent" />
      <div aria-hidden="true" className="pointer-events-none absolute -right-24 top-20 -z-10 h-64 w-64 rounded-full bg-decorative-glow/60 blur-3xl" />

      <div className="mx-auto w-full max-w-[480px]">
        <header className="text-center">
          <div className="mx-auto flex h-28 w-28 items-center justify-center overflow-hidden rounded-full border-4 border-surface bg-decorative-start text-4xl font-bold text-accent shadow-xl shadow-shadow-tint/10">
            {band.image && failedImage !== band.image.src ? (
              <Image
                src={band.image.src}
                alt={band.image.alt}
                width={112}
                height={112}
                priority
                unoptimized
                onError={() => setFailedImage(band.image?.src ?? "")}
                className="h-full w-full object-contain"
              />
            ) : (
              <span role="img" aria-label={`Imagem indisponível da banda ${band.name}`}>
                {Array.from(band.name.trim())[0]?.toLocaleUpperCase("pt-BR") || "♪"}
              </span>
            )}
          </div>
          <h1 className="mt-5 text-3xl font-bold leading-tight tracking-tight text-content [overflow-wrap:anywhere] sm:text-5xl">{band.name}</h1>
          {band.description.trim() && <p className="mx-auto mt-4 max-w-sm whitespace-pre-wrap break-words text-base leading-7 text-content-muted">
            <LinkifiedText text={band.description} variant="themed" />
          </p>}
        </header>

        <section aria-labelledby="band-links-title" className="mt-9">
          <h2 id="band-links-title" className="sr-only">Acompanhe {band.name}</h2>
          {visibleLinks.length > 0 ? <p className="mb-3 text-center text-xs text-content-subtle">Os links abrem em uma nova aba.</p> : (
            <p className="rounded-2xl border border-nav-border bg-surface/70 px-5 py-6 text-center text-sm leading-6 text-content-muted">Ainda não há links públicos para acompanhar esta banda.</p>
          )}
          <ul className="space-y-3">
            {visibleLinks.map((link) => {
              const href = getSafeExternalUrl(link.url);
              if (!href) return null;

              return (
                <li key={link.id}>
                  <a
                    href={href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="group flex min-h-[64px] min-w-0 items-center gap-4 rounded-2xl border border-nav-border bg-surface px-4 py-3 text-content shadow-app-card transition hover:border-accent-outline-hover hover:bg-accent-soft focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-accent-outline-hover motion-reduce:transition-none sm:px-5"
                  >
                    <span aria-hidden="true" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-lg font-bold text-accent group-hover:bg-surface">
                      <SocialPlatformIcon platform={link.platform} />
                    </span>
                    <span className="min-w-0 flex-1 [overflow-wrap:anywhere] text-sm font-semibold sm:text-base">{link.label || socialPlatforms[link.platform]}</span>
                    <span aria-hidden="true" className="shrink-0 text-lg text-brand-highlight">↗</span>
                  </a>
                </li>
              );
            })}
          </ul>
        </section>

        <footer className="mt-10 text-center text-xs text-content-subtle">
          Feito com <span className="font-semibold text-accent">BandUp</span>
        </footer>
      </div>
    </main>
  );
}
