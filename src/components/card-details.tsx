"use client";

import type { MouseEvent, ReactNode } from "react";
import { LinkifiedText } from "@/components/linkified-text";

// The card is a pointer shortcut; summary provides native keyboard/VoiceOver support.
// Never turn links, actions, controls or text selection into a disclosure click.
export function toggleCardDetails(event: MouseEvent<HTMLElement>) {
  const target = event.target as Element;
  if (event.defaultPrevented || target.closest?.("a, button, input, select, textarea, label, summary, [role='button'], [role='switch'], [contenteditable='true']")) return;
  const selection = event.currentTarget.ownerDocument.defaultView?.getSelection();
  if (selection && !selection.isCollapsed) return;
  const details = event.currentTarget.querySelector<HTMLDetailsElement>("details[data-card-details]");
  if (details) details.open = !details.open;
}

export default function CardDetails({ title, description, children }: {
  title: string;
  description: string | null;
  children?: ReactNode;
}) {
  if (!description?.trim() && !children) return null;
  return (
    <details data-card-details className="group mt-3">
      <summary aria-label={`Detalhes de ${title}`} className="flex min-h-11 w-fit cursor-pointer list-none items-center gap-2 rounded-lg px-1 text-xs font-medium text-brand focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-focus [&::-webkit-details-marker]:hidden">
        <span className="group-open:hidden">Ver detalhes</span>
        <span className="hidden group-open:inline">Recolher detalhes</span>
        <span aria-hidden="true" className="transition-transform group-open:rotate-180 motion-reduce:transition-none">⌄</span>
      </summary>
      {description?.trim() && <p className="mt-2 break-words whitespace-pre-wrap text-sm leading-6 text-content-muted">
        <LinkifiedText text={description} variant="themed" />
      </p>}
      {children}
    </details>
  );
}
