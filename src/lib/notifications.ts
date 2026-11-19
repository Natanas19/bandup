import type { NotificationReference } from "@/lib/notification-destination";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

export type NotificationItem = {
  id: string;
  title: string;
  message: string;
  origin?: string;
  createdAt: string;
  read: boolean;
  reference?: NotificationReference;
};

export type NotificationSnapshot = {
  recipientId: string;
  items: readonly NotificationItem[];
  unreadCount: number;
  clearCutoff?: string;
};

export type NotificationSource = {
  load(): Promise<NotificationSnapshot>;
  markRead(id: string, recipientId: string): Promise<NotificationSnapshot>;
  markAllRead(recipientId: string): Promise<NotificationSnapshot>;
  clearRead?(cutoff: string, recipientId: string): Promise<NotificationSnapshot>;
};

type NotificationRow = NotificationReference & {
  id: string;
  message: string;
  created_at: string;
  read_at: string | null;
};

const titles = new Map([
  ["task_assigned", "Tarefa atribuída"],
  ["event_created", "Evento na agenda"],
  ["entry_request_created", "Pedido de entrada"],
  ["entry_request_decided", "Decisão sobre pedido de entrada"],
]);

async function notificationAccess(expectedRecipient?: string) {
  const client = getSupabaseBrowserClient();
  const { data: { session }, error: sessionError } = await client.auth.getSession();
  if (sessionError || !session) throw new Error("Notification session unavailable");

  // Pin requests to the verified token so an account switch cannot retarget a write.
  const token = session.access_token;
  const { data: { user }, error } = await client.auth.getUser(token);
  if (error || !user || (expectedRecipient !== undefined && user.id !== expectedRecipient)) {
    throw new Error("Notification recipient unavailable");
  }

  const authorization = `Bearer ${token}`;
  return {
    client,
    authorization,
    recipientId: user.id,
    rows: () => client.from("notifications"),
  };
}

async function loadSnapshot({ rows, authorization, recipientId }: Awaited<ReturnType<typeof notificationAccess>>): Promise<NotificationSnapshot> {
  // Use the latest active read timestamp set by the database, across the whole
  // inbox. Capture it before the feed/count and keep the original precision.
  const cutoff = await rows().select("read_at").eq("recipient_id", recipientId)
    .is("cleared_at", null).not("read_at", "is", null)
    .order("read_at", { ascending: false }).limit(1).setHeader("Authorization", authorization);
  if (cutoff.error) throw new Error("Notification cutoff unavailable");

  const [recent, unread] = await Promise.all([
    rows().select("id, band_id, kind, content_id, message, created_at, read_at")
      .eq("recipient_id", recipientId).is("cleared_at", null)
      .order("created_at", { ascending: false }).order("id", { ascending: false })
      .limit(30).setHeader("Authorization", authorization).returns<NotificationRow[]>(),
    rows().select("id", { count: "exact", head: true })
      .eq("recipient_id", recipientId).is("cleared_at", null).is("read_at", null)
      .setHeader("Authorization", authorization),
  ]);
  if (recent.error || unread.error || unread.count === null) {
    throw new Error("Notification feed unavailable");
  }
  return {
    recipientId,
    unreadCount: unread.count,
    clearCutoff: cutoff.data?.[0]?.read_at ?? undefined,
    items: (recent.data ?? []).map(({ id, band_id, kind, content_id, message, created_at, read_at }) => ({
      id,
      title: titles.get(kind) ?? "Notificação",
      message,
      createdAt: created_at,
      read: read_at !== null,
      reference: { band_id, kind, content_id },
    })),
  };
}

export const notificationSource: NotificationSource = {
  async load() {
    return loadSnapshot(await notificationAccess());
  },
  async markRead(id, recipientId) {
    const access = await notificationAccess(recipientId);
    const { data, error } = await access.client.rpc("bandup_mark_notification_read", { p_notification_id: id })
      .setHeader("Authorization", access.authorization);
    if (error) throw error;
    if (data !== true) {
      // False can mean another tab already marked this notification.
      const { data: row, error: lookupError } = await access.rows().select("read_at")
        .eq("recipient_id", recipientId).eq("id", id).is("cleared_at", null)
        .setHeader("Authorization", access.authorization).maybeSingle();
      if (lookupError || !row?.read_at) throw new Error("Notification read not confirmed");
    }
    return loadSnapshot(access);
  },
  async markAllRead(recipientId) {
    const access = await notificationAccess(recipientId);
    const { error } = await access.client.rpc("bandup_mark_all_notifications_read")
      .setHeader("Authorization", access.authorization);
    if (error) throw error;
    return loadSnapshot(access);
  },
  async clearRead(cutoff, recipientId) {
    const access = await notificationAccess(recipientId);
    const { error } = await access.client.rpc("bandup_clear_read_notifications", { p_cutoff: cutoff })
      .setHeader("Authorization", access.authorization).retry(false);
    if (error) throw error;
    return loadSnapshot(access);
  },
};
