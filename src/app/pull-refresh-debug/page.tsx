import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { isPullRefreshPreview } from "@/lib/pull-refresh-preview";

export const metadata: Metadata = isPullRefreshPreview() ? {
  title: "BandUp Diagnóstico",
  applicationName: "BandUp Diagnóstico",
  appleWebApp: { capable: true, title: "BandUp Diagnóstico", statusBarStyle: "default" },
  manifest: "/pull-refresh-debug-manifest",
} : {};

export default function PullRefreshDebugPage() {
  if (!isPullRefreshPreview()) notFound();

  return (
    <main className="mx-auto w-full max-w-xl flex-1 px-6 pt-48 pb-12 text-content">
      <h1 className="text-2xl font-semibold">BandUp Diagnóstico</h1>
      <p className="mt-3">No topo da página, deslize para baixo e observe os eventos no painel.</p>
    </main>
  );
}
