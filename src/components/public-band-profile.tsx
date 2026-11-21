"use client";

import { useState } from "react";
import Image from "next/image";
import SocialPlatformIcon from "@/components/social-platform-icon";
import NavigationIcon from "@/components/navigation-icon";
import type { PublicBand, PublicBandProfileLink } from "@/lib/public-band-data";
import type { PublicBandEvent } from "@/lib/public-band-events";
import { publicLinkPlatforms } from "@/lib/public-link-url";

const explore = [
  { label: "Eventos", icon: "CalendarDays" },
  { label: "Ingressos", icon: "Ticket" },
  { label: "Loja", icon: "Store" },
  { label: "Músicas", icon: "Music" },
  { label: "Fotos", icon: "Image" },
] as const;

const publicEventDate = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
  timeZone: "America/Sao_Paulo", timeZoneName: "short",
});

export default function PublicBandProfile({ band, links = [], events = [], preview = false }: {
  band: PublicBand;
  links?: PublicBandProfileLink[];
  events?: PublicBandEvent[];
  preview?: boolean;
}) {
  const [failedImage, setFailedImage] = useState("");
  const Container = preview ? "div" : "main";
  const BandHeading = preview ? "h2" : "h1";
  const SectionHeading = preview ? "h3" : "h2";
  return (
    <Container className="relative isolate min-w-0 flex-1 overflow-hidden px-4 pb-10 pt-8 sm:px-6 sm:pb-14 sm:pt-12">
      <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-96 bg-gradient-to-b from-decorative-start via-decorative-end to-transparent" />
      <div aria-hidden="true" className="pointer-events-none absolute -right-24 top-20 -z-10 h-64 w-64 rounded-full bg-decorative-glow/60 blur-3xl" />

      <div className="mx-auto w-full max-w-2xl">
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

          <section aria-labelledby="public-band-explore-heading" className="mt-9 sm:mt-10">
            <SectionHeading id="public-band-explore-heading" className="text-lg font-semibold text-content">Explore</SectionHeading>
            <ul className="mt-3 grid grid-cols-2 gap-2.5 sm:gap-3">
              {explore.map(({ label, icon }) => {
                const available = label === "Eventos" && events.length > 0;
                const Card = available ? "a" : "div";
                return <li key={label}>
                <Card href={available ? "#eventos" : undefined}
                  className={`flex min-h-[4.5rem] min-w-0 items-center gap-2 rounded-2xl border border-nav-border bg-surface p-2.5 sm:gap-3 sm:px-4 ${available ? "hover:bg-accent-soft focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-focus" : ""}`}>
                  <span className="shrink-0 rounded-xl bg-accent-soft p-2 text-brand">
                    <NavigationIcon name={icon} className="h-4 w-4 sm:h-5 sm:w-5" />
                  </span>
                  <span className="min-w-0 [overflow-wrap:anywhere]">
                    <span className="block text-sm font-semibold text-content">{label}</span>
                    <span className="block text-xs text-content-muted">{available ? "Ver agenda" : label === "Eventos" ? "Sem eventos públicos" : "Em breve"}</span>
                  </span>
                </Card>
                </li>
              })}
            </ul>
          </section>

        {events.length > 0 && (
          <section id="eventos" aria-labelledby="public-band-events-heading" className="mt-7 scroll-mt-4 sm:mt-8">
            <SectionHeading id="public-band-events-heading" className="text-lg font-semibold text-content">Eventos</SectionHeading>
            <ul className="mt-3 space-y-2.5">
              {events.map(event => (
                <li key={event.id} className="min-w-0 rounded-2xl border border-nav-border bg-surface px-4 py-3">
                  <p className="font-semibold text-content [overflow-wrap:anywhere]">{event.title}</p>
                  <p className="mt-1 text-sm text-content-muted">
                    <time dateTime={event.start_at}>{publicEventDate.format(new Date(event.start_at))}</time>
                    {event.end_at && <> – <time dateTime={event.end_at}>{publicEventDate.format(new Date(event.end_at))}</time></>}
                  </p>
                </li>
              ))}
            </ul>
          </section>
        )}

        {links.length > 0 && (
          <section aria-labelledby="public-band-links-heading" className="mt-7 sm:mt-8">
            <SectionHeading id="public-band-links-heading" className="text-lg font-semibold text-content">Redes e plataformas</SectionHeading>
            <ol className="mt-3 grid gap-2.5 sm:grid-cols-2 sm:gap-3">
              {links.map(link => {
                const destination = link.platform === "custom" ? new URL(link.url).hostname : publicLinkPlatforms[link.platform];
                return (
                  <li key={link.position}>
                    <a href={link.url} target="_blank" rel="noopener noreferrer"
                      className="flex min-h-14 min-w-0 items-center gap-2.5 rounded-2xl border border-nav-border bg-surface px-3 py-2 text-sm text-content shadow-app-card transition hover:bg-accent-soft focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-focus">
                      <span className="shrink-0 rounded-xl bg-accent-soft p-2 text-brand">
                        <SocialPlatformIcon platform={link.platform === "custom" ? "other" : link.platform} />
                      </span>
                      <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">
                        <span className="block font-semibold">{link.label ?? destination}</span>
                        {link.label && link.label !== destination && <span className="block text-xs text-content-muted">{destination}</span>}
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
