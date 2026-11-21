import { getPublishedBandProfile } from "@/lib/public-bands";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const profile = await getPublishedBandProfile(slug).catch(() => null);
  return Response.json(profile, {
    status: profile ? 200 : 404,
    headers: { "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow" },
  });
}
