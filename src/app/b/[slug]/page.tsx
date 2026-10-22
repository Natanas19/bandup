import type { Metadata } from "next";
import { notFound } from "next/navigation";
import PublicBandProfile from "@/components/public-band-profile";
import { getPublicBandBySlug } from "@/lib/public-bands";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  try {
    const band = await getPublicBandBySlug(slug);
    if (band) {
      return {
        title: `${band.name} | BandUp`,
        description: band.description || "Conheça os links públicos desta banda.",
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
  const { slug } = await params;
  const band = await getPublicBandBySlug(slug);
  if (!band) notFound();
  return <PublicBandProfile band={band} />;
}
