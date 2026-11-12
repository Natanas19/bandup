import "server-only";
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
const filename = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(jpg|png|webp)$/;
type Outcome = "empty" | "progress" | "retry" | "unsafe";
type Lease = Readonly<{ operation_id: string; band_id: string; lease_token: string }>;
export type CleanupSummary = {
  claimed: number; emptyChecks: number; completed: number; deferred: number;
  failures: number; lostLeases: number; objectsRequested: number; listCalls: number; deleteCalls: number;
};
class LostLease extends Error {}

function leaseFrom(value: unknown, token: string): Lease {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid lease");
  const row = value as Record<string, unknown>;
  if (typeof row.operation_id !== "string" || !uuid.test(row.operation_id)
    || typeof row.band_id !== "string" || !uuid.test(row.band_id)
    || row.lease_token !== token || row.bucket_id !== "band-logos"
    || row.object_prefix !== `${row.band_id}/`) throw new Error("Invalid lease");
  return Object.freeze({ operation_id: row.operation_id, band_id: row.band_id, lease_token: token });
}

// Every limit is fixed server-side. No user-supplied bucket, band, path or batch size.
export async function runBandLogoCleanup(client: SupabaseClient, signal: AbortSignal,
  options: { now?: () => number; token?: () => string } = {}): Promise<CleanupSummary> {
  const now = options.now ?? Date.now;
  const deadline = now() + 20_000;
  const summary: CleanupSummary = { claimed: 0, emptyChecks: 0, completed: 0, deferred: 0,
    failures: 0, lostLeases: 0, objectsRequested: 0, listCalls: 0, deleteCalls: 0 };
  for (let jobNumber = 0; jobNumber < 3 && now() < deadline - 2000 && !signal.aborted; jobNumber++) {
    let lease: Lease;
    try {
      const token = (options.token ?? randomUUID)();
      if (!uuid.test(token)) throw new Error("Invalid claim token");
      const claim = await client.rpc("bandup_claim_band_logo_cleanup", { p_claim_id: token });
      if (claim.error) throw new Error("Queue unavailable");
      if (claim.data === null) break;
      lease = leaseFrom(claim.data, token);
      summary.claimed++;
    } catch {
      summary.failures++; break; // Unknown claim response: let its lease expire, never invent a target.
    }
    const args = { p_operation_id: lease.operation_id, p_lease_token: lease.lease_token };
    const renew = async () => {
      if (signal.aborted || now() >= deadline) throw new Error("Run budget reached");
      const result = await client.rpc("bandup_renew_band_logo_cleanup", args);
      if (result.error) throw new Error("Queue unavailable");
      if (result.data !== true) throw new LostLease();
    };
    let outcome: Outcome = "retry";
    let lost = false;
    try {
      const storage = client.storage.from("band-logos");
      for (let round = 0; round < 5 && now() < deadline && !signal.aborted; round++) {
        await renew();
        summary.listCalls++;
        // Always offset zero: deleting while incrementing offsets would skip objects.
        const listing = await storage.list(lease.band_id, { limit: 100, offset: 0,
          sortBy: { column: "name", order: "asc" } }, { signal });
        if (listing.error || !Array.isArray(listing.data) || listing.data.length > 100) throw new Error("Storage unavailable");
        if (listing.data.length === 0) { outcome = "empty"; summary.emptyChecks++; break; }
        const entries = listing.data;
        if (entries.some(entry => typeof entry.id !== "string" || !entry.id
          || typeof entry.name !== "string" || !filename.test(entry.name))
          || new Set(entries.map(entry => entry.name)).size !== entries.length) {
          outcome = "unsafe"; break; // Unexpected folder/legacy name needs manual review; no recursive delete.
        }
        const paths = entries.map(entry => `${lease.band_id}/${entry.name}`);
        if (paths.some(path => !path.startsWith(`${lease.band_id}/`) || path.split("/").length !== 2)) {
          outcome = "unsafe"; break;
        }
        await renew(); // Reauthorize the exact lease immediately before every Storage mutation.
        summary.deleteCalls++; summary.objectsRequested += paths.length;
        const removal = await storage.remove(paths);
        if (removal.error) throw new Error("Storage unavailable");
        outcome = "progress"; // Success response alone never proves that the prefix is empty.
      }
    } catch (error) {
      if (error instanceof LostLease) { summary.lostLeases++; lost = true; }
      else { outcome = "retry"; summary.failures++; }
    }
    if (lost) continue; // A stale worker must never acknowledge another worker's job.
    try {
      const finish = await client.rpc("bandup_finish_band_logo_cleanup", { ...args, p_outcome: outcome });
      if (finish.error) throw new Error("Queue unavailable");
      if (finish.data === null) { summary.lostLeases++; continue; }
      if (!["pending", "completed", "needs_attention"].includes(finish.data)
        || (finish.data === "completed" && outcome !== "empty")) throw new Error("Invalid acknowledgement");
      if (finish.data === "completed") summary.completed++;
      else if (finish.data === "needs_attention") summary.failures++;
      else summary.deferred++;
    } catch { summary.failures++; } // Lost acknowledgement is safe: next pass observes actual queue/Storage state.
  }
  return summary;
}
