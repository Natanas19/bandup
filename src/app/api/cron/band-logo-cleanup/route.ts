import { cleanupConfiguration, cleanupRequestAuthorized, createBandLogoCleanupClient } from "@/lib/band-logo-cleanup-server";
import { runBandLogoCleanup } from "@/lib/band-logo-cleanup-worker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;
const headers = { "Cache-Control": "no-store" };

export async function GET(request: Request) {
  if (!cleanupRequestAuthorized(request.headers.get("authorization"), process.env.CRON_SECRET)) {
    return Response.json({ ok: false }, { status: 401, headers });
  }
  if (process.env.BANDUP_BAND_LOGO_CLEANUP_ENABLED !== "true") {
    return Response.json({ ok: false }, { status: 503, headers });
  }
  if (new URL(request.url).search) return Response.json({ ok: false }, { status: 400, headers });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25_000);
  try {
    const config = cleanupConfiguration(process.env);
    const summary = await runBandLogoCleanup(createBandLogoCleanupClient(config, controller.signal), controller.signal);
    console.info("band_logo_cleanup", summary); // Fixed aggregate fields only; no SDK errors or identifiers.
    const ok = summary.failures === 0 && summary.lostLeases === 0;
    return Response.json({ ok, ...summary }, { status: ok ? 200 : 503, headers });
  } catch {
    console.info("band_logo_cleanup", { invocationFailed: 1 });
    return Response.json({ ok: false }, { status: 503, headers });
  } finally { clearTimeout(timer); }
}

// Prevent Next's automatic HEAD -> GET behavior from running this worker.
export function HEAD() { return new Response(null, { status: 405, headers }); }
