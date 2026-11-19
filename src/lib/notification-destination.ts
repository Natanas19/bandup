export type NotificationReference = {
  band_id: string | null;
  kind: string;
  content_id: string;
};

export const notificationUnavailable = "O conteúdo desta notificação não está disponível.";

export function notificationId(value: string | null | undefined): string | null {
  return value && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value)
    ? value.toLowerCase() : null;
}

export function notificationHref(reference?: NotificationReference): string | null {
  if (!reference) return null;
  const bandId = notificationId(reference.band_id);
  const contentId = notificationId(reference.content_id);
  if (!bandId || !contentId) return null;

  const query = `notificacao=${contentId}`;
  switch (reference.kind) {
    case "event_created": return `/bandas/${bandId}/agenda?${query}`;
    case "task_assigned": return `/bandas/${bandId}/tarefas?${query}`;
    case "entry_request_created": return `/bandas/${bandId}/membros?${query}`;
    case "entry_request_decided": return `/descobrir?${query}&banda=${bandId}`;
    default: return null;
  }
}
