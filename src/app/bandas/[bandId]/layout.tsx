import type { ReactNode } from "react";
import BandWorkspace from "@/components/band-workspace";

export default async function BandLayout({ children, params }: {
  children: ReactNode;
  params: Promise<{ bandId: string }>;
}) {
  const { bandId } = await params;
  return <BandWorkspace key={bandId} bandId={bandId}>{children}</BandWorkspace>;
}
