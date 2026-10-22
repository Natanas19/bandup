"use client";

import { useState } from "react";
import Image from "next/image";
import { LinkifiedText } from "@/components/linkified-text";
import type { PublicBand } from "@/lib/public-band-data";
import { getSafeExternalUrl, socialPlatforms } from "@/lib/social-links";

const platformMarks = {
  spotify: "S",
  youtube: "▶",
  instagram: "◎",
  tiktok: "♪",
  facebook: "f",
  website: "↗",
  other: "↗",
} as const;

export default function PublicBandProfile({ band }: { band: PublicBand }) {
  const [failedImage, setFailedImage] = useState("");
  return (
    <main className="relative isolate min-w-0 flex-1 overflow-hidden px-4 py-10 sm:px-6 sm:py-16">
      <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-96 bg-gradient-to-b from-violet-100 via-violet-50 to-transparent" />
      <div aria-hidden="true" className="pointer-events-none absolute -right-24 top-20 -z-10 h-64 w-64 rounded-full bg-fuchsia-100/60 blur-3xl" />

      <div className="mx-auto w-full max-w-[480px]">
        <header className="text-center">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-violet-700">Música para estar perto</p>
          <div className="mx-auto mt-6 flex h-28 w-28 items-center justify-center overflow-hidden rounded-full border-4 border-white bg-violet-100 text-4xl font-bold text-violet-700 shadow-xl shadow-violet-900/10">
            {band.image && failedImage !== band.image.src ? (
              <Image
                src={band.image.src}
                alt={band.image.alt}
                width={112}
                height={112}
                priority
                unoptimized
                onError={() => setFailedImage(band.image?.src ?? "")}
                className="h-full w-full object-cover"
              />
            ) : (
              <span role="img" aria-label={`Imagem indisponível da banda ${band.name}`}>
                {band.name.slice(0, 1)}
              </span>
            )}
          </div>
          <h1 className="mt-5 break-words text-4xl font-bold tracking-tight text-zinc-900 sm:text-5xl">{band.name}</h1>
          <p className="mx-auto mt-4 max-w-sm whitespace-pre-wrap break-words text-base leading-7 text-zinc-600">
            <LinkifiedText text={band.description} />
          </p>
        </header>

        <section aria-labelledby="band-links-title" className="mt-9">
          <h2 id="band-links-title" className="sr-only">Acompanhe {band.name}</h2>
          <p className="mb-3 text-center text-xs text-zinc-500">Os links abrem em uma nova aba.</p>
          <ul className="space-y-3">
            {band.links.map((link) => {
              const href = getSafeExternalUrl(link.url);
              if (!href) return null;

              return (
                <li key={link.id}>
                  <a
                    href={href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="group flex min-h-[64px] min-w-0 items-center gap-4 rounded-2xl border border-violet-100 bg-white px-4 py-3 text-zinc-900 shadow-[0_12px_36px_-28px_rgba(54,36,104,0.35)] transition hover:border-violet-300 hover:bg-violet-50 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-violet-300 motion-reduce:transition-none sm:px-5"
                  >
                    <span aria-hidden="true" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-violet-50 text-lg font-bold text-violet-700 group-hover:bg-white">
                      {platformMarks[link.platform]}
                    </span>
                    <span className="min-w-0 flex-1 break-words text-sm font-semibold sm:text-base">{link.label || socialPlatforms[link.platform]}</span>
                    <span aria-hidden="true" className="shrink-0 text-lg text-violet-500">↗</span>
                  </a>
                </li>
              );
            })}
          </ul>
        </section>

        <section aria-labelledby="coming-soon-title" className="mt-10">
          <h2 id="coming-soon-title" className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">Mais encontros, em breve</h2>
          <div className="mt-3 grid grid-cols-1 gap-3 min-[360px]:grid-cols-2">
            <article className="rounded-2xl border border-dashed border-violet-200 bg-white/60 p-4">
              <span className="text-xs font-medium text-violet-700">Em breve</span>
              <h3 className="mt-2 font-semibold text-zinc-900">Ingressos</h3>
              <p className="mt-1 text-sm leading-6 text-zinc-600">Novas datas e experiências ao vivo.</p>
            </article>
            <article className="rounded-2xl border border-dashed border-violet-200 bg-white/60 p-4">
              <span className="text-xs font-medium text-violet-700">Em breve</span>
              <h3 className="mt-2 font-semibold text-zinc-900">Loja da banda</h3>
              <p className="mt-1 text-sm leading-6 text-zinc-600">Um pedacinho da banda com você.</p>
            </article>
          </div>
        </section>

        <footer className="mt-10 text-center text-xs text-zinc-500">
          Feito com <span className="font-semibold text-violet-700">BandUp</span>
        </footer>
      </div>
    </main>
  );
}
