import { PUBLIC_IDENTITY_ENABLED } from "@/lib/publication-control";
import PublicationUnavailable from "@/components/publication-unavailable";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import PublicBandProfile from "@/components/public-band-profile";
import { getPublicBandBySlug, getPublishedBandProfile } from "@/lib/public-bands";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

type Props = { params: Promise<{ slug: string }> };
type PageProps = Props & { searchParams: Promise<{ editorBand?: string | string[] }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  if (!PUBLIC_IDENTITY_ENABLED) return { title: "Perfil público indisponível | BandUp", robots: { index: false, follow: false } };
  const { slug } = await params;
  try {
    const band = await getPublicBandBySlug(slug);
    if (band) {
      return {
        title: `${band.name} | BandUp`,
        description: band.description || "Conheça esta banda.",
        robots: { index: false, follow: false },
      };
    }
  } catch {
    // Rendering handles the failure; metadata must never contain backend details.
  }
  return {
    title: "Página indisponível | BandUp",
    description: "Esta página não está disponível.",
    robots: { index: false, follow: false },
  };
}

export default async function PublicBandPage({ params, searchParams }: PageProps) {
  if (!PUBLIC_IDENTITY_ENABLED) return <PublicationUnavailable />;
  const { slug } = await params;
  const profile = await getPublishedBandProfile(slug);
  if (!profile) notFound();
  const { editorBand } = await searchParams;
  if (typeof editorBand !== "string" || !/^[a-z0-9-]{1,64}$/i.test(editorBand)) {
    return <PublicBandProfile {...profile} />;
  }

  return <>
    <nav aria-label="Retorno ao BandUp"
      className="mx-auto w-full max-w-2xl pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))] pt-[calc(env(safe-area-inset-top)+0.5rem)] sm:pl-[max(1.5rem,env(safe-area-inset-left))] sm:pr-[max(1.5rem,env(safe-area-inset-right))]">
      <Link href={`/bandas/${editorBand}/perfil-publico`}
        className="inline-flex min-h-11 items-center gap-2 rounded-lg px-3 text-sm font-semibold text-brand hover:bg-accent-soft focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-focus">
        <span aria-hidden="true">←</span> Voltar ao editor do perfil público
      </Link>
    </nav>
    <PublicBandProfile {...profile} />
  </>;
}
