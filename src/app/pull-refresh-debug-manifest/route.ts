import manifest from "../manifest";

export function GET() {
  return Response.json({
    ...manifest(),
    id: "/?debugPullRefresh=1",
    name: "BandUp Diagnóstico",
    short_name: "BandUp Diag",
    start_url: "/cadastro?debugPullRefresh=1",
  }, { headers: { "Content-Type": "application/manifest+json" } });
}
