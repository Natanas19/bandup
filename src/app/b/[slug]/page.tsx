import { PUBLIC_IDENTITY_ENABLED } from "@/lib/publication-control";
import PublicationUnavailable from "@/components/publication-unavailable";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import PublicBandProfile from "@/components/public-band-profile";
import { getPublicBandBySlug, getPublishedBandProfile } from "@/lib/public-bands";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

type Props = { params: Promise<{ slug: string }> };

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

export default async function PublicBandPage({ params }: Props) {
  if (!PUBLIC_IDENTITY_ENABLED) return <PublicationUnavailable />;
  const { slug } = await params;
  const profile = await getPublishedBandProfile(slug);
  if (!profile) notFound();
  return <PublicBandProfile {...profile} />;
}
