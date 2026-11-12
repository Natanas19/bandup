import type { SupabaseClient } from "@supabase/supabase-js";
import { bandPhotoSession } from "./band-logo-upload";
import { validDeletionAttempt, type BandDeletionAttempt, type BandDeletionAttemptStore } from "./band-deletion-attempts";

export type DeletionResult = { status: "deleted" } | { status: "uncertain"; message: string };
export const DELETION_UNCERTAIN = "Resultado inconclusivo. A ausência de recibo não confirma que a banda existe nem que a exclusão falhou. Consulte novamente ou repita a mesma tentativa nas configurações. Os recibos ficam disponíveis por 90 dias.";
const invalidSession = () => new Error("Não foi possível verificar sua sessão. Entre novamente na mesma conta para recuperar a tentativa.");

function confirmed(data: unknown, operationId: string): boolean {
  if (!data || typeof data !== "object") return false;
  const receipt = data as Record<string, unknown>;
  return receipt.status === "deleted" && receipt.operation_id === operationId
    && ["pending", "processing", "completed", "needs_attention", "not_available"].includes(String(receipt.cleanup_status));
}

export async function loadBandDeletionAccess(client: SupabaseClient, signal: AbortSignal) {
  const { data, error } = await client.auth.getSession();
  const actorId = data.session?.user.id;
  if (error || !actorId || signal.aborted) throw invalidSession();
  const session = await bandPhotoSession(client, actorId, signal);
  return { actorId, ...session };
}

// Only this RPC can establish success; missing membership/band is never evidence.
export async function recoverBandDeletion(client: SupabaseClient, attempt: BandDeletionAttempt,
  signal: AbortSignal): Promise<DeletionResult> {
  if (!validDeletionAttempt(attempt)) throw invalidSession();
  const { scoped, verify } = await bandPhotoSession(client, attempt.actorId, signal);
  try {
    const { data, error } = await scoped.rpc("bandup_get_band_deletion", { p_operation_id: attempt.operationId });
    await verify();
    if (!error && confirmed(data, attempt.operationId)) return { status: "deleted" };
  } catch { if (signal.aborted) throw invalidSession(); }
  return { status: "uncertain", message: DELETION_UNCERTAIN };
}

export async function submitBandDeletion(client: SupabaseClient, store: BandDeletionAttemptStore,
  actorId: string, bandId: string, confirmation: string, expectedName: string, signal: AbortSignal,
  previous?: BandDeletionAttempt): Promise<{
    attempt: BandDeletionAttempt; result: DeletionResult;
  }> {
  if (!confirmation || confirmation !== expectedName) throw new Error("Digite o nome exato da banda, sem alterar espaços, letras ou acentos.");
  const { scoped, verify } = await bandPhotoSession(client, actorId, signal);
  // Persistence failure is fail-closed. An existing attempt always wins, even
  // after a rename or a concurrent submission in another tab.
  if (previous && (!validDeletionAttempt(previous) || previous.actorId !== actorId || previous.bandId !== bandId)) throw invalidSession();
  const persisted = previous ? await store.read(actorId, bandId) : null;
  // Another tab may have confirmed and removed the record. An old form must
  // recover its original ID rather than accidentally creating another one.
  if (previous && (!persisted || persisted.operationId !== previous.operationId)) {
    return { attempt: previous, result: await recoverBandDeletion(client, previous, signal) };
  }
  const attempt = previous ? persisted! : await store.getOrCreate(actorId, bandId, confirmation);
  if (!validDeletionAttempt(attempt) || attempt.actorId !== actorId || attempt.bandId !== bandId) throw invalidSession();
  await verify();
  if (attempt.confirmation !== confirmation) {
    return { attempt, result: await recoverBandDeletion(client, attempt, signal) };
  }
  let code = "";
  try {
    const { data, error } = await scoped.rpc("bandup_delete_band", {
      p_band_id: attempt.bandId, p_confirmation: attempt.confirmation, p_operation_id: attempt.operationId,
    });
    code = error?.code ?? "";
    await verify();
    if (!error && confirmed(data, attempt.operationId)) return { attempt, result: { status: "deleted" } };
  } catch { if (signal.aborted) throw invalidSession(); }
  const recovered = await recoverBandDeletion(client, attempt, signal);
  if (recovered.status === "deleted") return { attempt, result: recovered };
  const message = code === "22023" ? "O nome não corresponde ao nome atual da banda. A tentativa foi preservada; nenhuma nova operação será criada automaticamente."
    : code === "42501" ? "Não foi possível autorizar a exclusão, ou há outra tentativa em andamento. Consulte o resultado antes de repetir."
    : ["55P03", "40001", "40P01"].includes(code) ? "Há outra alteração em andamento. Consulte o resultado e tente novamente com a mesma operação."
    : ["PGRST202", "42883", "25000"].includes(code) ? "A exclusão está indisponível neste momento. A tentativa foi preservada."
    : DELETION_UNCERTAIN;
  return { attempt, result: { status: "uncertain", message } };
}
