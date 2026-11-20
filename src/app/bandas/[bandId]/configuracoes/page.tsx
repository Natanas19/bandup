import BandSettings from "@/components/band-settings";

export default async function BandSettingsPage({ params }: { params: Promise<{ bandId: string }> }) {
  const { bandId } = await params;
  return <BandSettings bandId={bandId} activeSection="configuracoes" />;
}
