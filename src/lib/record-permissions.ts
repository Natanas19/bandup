// Mirrors the installed local tasks/events RLS. These UI checks never replace RLS.
export type BandAccess = { userId: string; role: "admin" | "member" } | null;
type OwnedRecord = { created_by: string };
type AssignedRecord = OwnedRecord & { assigned_to: string | null };

export function getBandAccess(userId: string | null, role: unknown): BandAccess {
  return userId && (role === "admin" || role === "member") ? { userId, role } : null;
}

export function canEditEvent(access: BandAccess, record: OwnedRecord): boolean {
  return !!access && (access.role === "admin" || record.created_by === access.userId);
}

export function canEditTask(access: BandAccess, task: AssignedRecord): boolean {
  return canEditEvent(access, task) || (!!access && task.assigned_to === access.userId);
}

export function canReassignTask(access: BandAccess, task: AssignedRecord): boolean {
  return canEditEvent(access, task);
}

export function canSaveTask(access: BandAccess, task: AssignedRecord, nextAssignee: string | null): boolean {
  return canEditTask(access, task) && (canReassignTask(access, task) || nextAssignee === access?.userId);
}

export function recordWriteError(error: { code?: string } | null, action: string): string {
  return error?.code === "42501"
    ? `Você não tem permissão para ${action}. Recarregue a página para atualizar seu acesso.`
    : `Não foi possível ${action}. O registro pode ter sido removido ou suas permissões podem ter mudado. Recarregue a página e tente novamente.`;
}
