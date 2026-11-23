import manifest from "../manifest";
import { isPullRefreshPreview, pullRefreshPreviewPath } from "@/lib/pull-refresh-preview";

export function GET() {
  if (!isPullRefreshPreview()) return new Response(null, { status: 404 });

  return Response.json({
    ...manifest(),
    id: pullRefreshPreviewPath,
    name: "BandUp Diagnóstico",
    short_name: "BandUp Diag",
    start_url: pullRefreshPreviewPath,
    scope: pullRefreshPreviewPath,
  }, { headers: { "Content-Type": "application/manifest+json" } });
}
