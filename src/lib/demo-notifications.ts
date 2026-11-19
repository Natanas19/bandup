import type { NotificationItem, NotificationSnapshot, NotificationSource } from "@/lib/notifications";

const examples: readonly NotificationItem[] = [
  {
    id: "demo-request",
    title: "Pedido de entrada",
    message: "Uma pessoa solicitou entrada na banda.",
    origin: "Banda fictícia Aurora",
    createdAt: "2026-11-18T14:30:00Z",
    read: false,
  },
  {
    id: "demo-task",
    title: "Tarefa atribuída",
    message: "Você recebeu a tarefa de revisar o repertório.",
    origin: "Banda fictícia Horizonte",
    createdAt: "2026-11-17T19:00:00Z",
    read: false,
  },
  {
    id: "demo-event",
    title: "Evento na agenda",
    message: "Um ensaio foi adicionado à agenda da banda.",
    origin: "Banda fictícia Aurora",
    createdAt: "2026-11-16T20:00:00Z",
    read: true,
  },
];

export function createDemoNotificationSource(): NotificationSource {
  const marked = new Set<string>();

  function snapshot(): NotificationSnapshot {
    const items = examples.map(item => ({ ...item, read: item.read || marked.has(item.id) }));
    return { recipientId: "demo-recipient", items, unreadCount: items.filter(item => !item.read).length };
  }

  return {
    async load() {
      return snapshot();
    },
    async markRead(id) {
      if (examples.some(item => item.id === id)) marked.add(id);
      return snapshot();
    },
    async markAllRead() {
      for (const item of examples) marked.add(item.id);
      return snapshot();
    },
  };
}
