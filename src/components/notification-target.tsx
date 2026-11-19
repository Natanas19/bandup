"use client";

import { useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { notificationId, notificationUnavailable } from "@/lib/notification-destination";

const targetElementId = "conteudo-da-notificacao";
export const notificationTargetProps = { id: targetElementId, tabIndex: -1 };

export function useNotificationTarget() {
  return notificationId(useSearchParams()?.get("notificacao"));
}

export function NotificationTargetStatus({ target, found }: { target: string | null; found: boolean }) {
  useEffect(() => {
    if (!target) return;
    const element = document.getElementById(targetElementId);
    element?.focus({ preventScroll: true });
    element?.scrollIntoView({ block: "nearest" });
  }, [target, found]);

  return target && !found
    ? <p {...notificationTargetProps} role="status" className="my-4 scroll-mt-24 rounded-xl border border-outline bg-surface p-4 text-sm text-content">{notificationUnavailable}</p>
    : null;
}

export function UnavailableNotificationTarget() {
  return <NotificationTargetStatus target={useNotificationTarget()} found={false} />;
}
