"use client";

import { useState } from "react";
import Image from "next/image";
import SocialPlatformIcon from "@/components/social-platform-icon";
import NavigationIcon from "@/components/navigation-icon";
import type { PublicBand, PublicBandProfileLink } from "@/lib/public-band-data";
import { publicLinkPlatforms } from "@/lib/public-link-url";

export default function PublicBandProfile({ band, links = [], preview = false }: {
  band: PublicBand;
  links?: PublicBandProfileLink[];
  preview?: boolean;
}) {
  const [failedImage, setFailedImage] = useState("");
  const Container = preview ? "div" : "main";
  const BandHeading = preview ? "h2" : "h1";
  const LinksHeading = preview ? "h3" : "h2";
  return (
    <Container className="relative isolate min-w-0 flex-1 overflow-hidden px-4 py-10 sm:px-6 sm:py-16">
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
                priority={!preview}
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
          <BandHeading className="mt-5 text-3xl font-bold leading-tight tracking-tight text-content [overflow-wrap:anywhere] sm:text-5xl">{band.name}</BandHeading>
          {band.description.trim() && <p className="mx-auto mt-4 max-w-sm whitespace-pre-wrap break-words text-base leading-7 text-content-muted">
            {band.description}
          </p>}
        </header>

        {links.length > 0 && (
          <section aria-labelledby="public-band-links-heading" className="mt-8">
            <LinksHeading id="public-band-links-heading" className="text-center text-lg font-semibold text-content">Links da banda</LinksHeading>
            <ol className="mt-4 space-y-3">
              {links.map(link => {
                const destination = link.platform === "custom" ? new URL(link.url).hostname : publicLinkPlatforms[link.platform];
                return (
                  <li key={link.position}>
                    <a href={link.url} target="_blank" rel="noopener noreferrer"
                      className="flex min-h-14 min-w-0 items-center gap-3 rounded-2xl border border-nav-border bg-surface px-4 py-3 text-content shadow-app-card transition hover:bg-accent-soft focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-focus">
                      <span className="shrink-0 rounded-xl bg-accent-soft p-2 text-brand">
                        <SocialPlatformIcon platform={link.platform === "custom" ? "other" : link.platform} />
                      </span>
                      <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">
                        <span className="block font-semibold">{link.label ?? destination}</span>
                        {link.label && link.label !== destination && <span className="block text-sm text-content-muted">{destination}</span>}
                        <span className="sr-only"> (abre em nova aba)</span>
                      </span>
                      <NavigationIcon name="ArrowUpRight" className="h-4 w-4 text-brand" />
                    </a>
                  </li>
                );
              })}
            </ol>
          </section>
        )}

        <footer className="mt-10 text-center text-xs text-content-subtle">
          Feito com <span className="font-semibold text-accent">BandUp</span>
        </footer>
      </div>
    </Container>
  );
}
