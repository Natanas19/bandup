import { redirect } from "next/navigation";

export default async function LegacyPersonalSectionPage({ params }: { params: Promise<{ section: string }> }): Promise<never> {
  const { section } = await params;
  redirect(`/dashboard/${encodeURIComponent(section)}`);
}
