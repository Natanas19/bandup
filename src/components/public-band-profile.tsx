"use client";

import { useState } from "react";
import Image from "next/image";
import type { PublicBand } from "@/lib/public-band-data";

export default function PublicBandProfile({ band }: { band: PublicBand }) {
  const [failedImage, setFailedImage] = useState("");
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
            {band.description}
          </p>}
        </header>

        <footer className="mt-10 text-center text-xs text-content-subtle">
          Feito com <span className="font-semibold text-accent">BandUp</span>
        </footer>
      </div>
    </main>
  );
}
