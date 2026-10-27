import type { ReactNode } from "react";

// Same lightweight, currentColor SVG approach as SocialPlatformIcon.
const icons = {
  LayoutDashboard: <><rect x="3" y="3" width="7" height="9" rx="1" /><rect x="14" y="3" width="7" height="5" rx="1" /><rect x="14" y="12" width="7" height="9" rx="1" /><rect x="3" y="16" width="7" height="5" rx="1" /></>,
  ListTodo: <><path d="m3 6 2 2 4-4M13 6h8M13 12h8M13 18h8" /><rect x="3" y="11" width="5" height="5" rx="1" /><path d="M3 21h5" /></>,
  CalendarDays: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M16 3v4M8 3v4M3 11h18M8 15h.01M12 15h.01M16 15h.01M8 18h.01M12 18h.01M16 18h.01" /></>,
  Users: <><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" /><circle cx="9" cy="7" r="4" /></>,
  Link: <><path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-2 2M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l2-2" /></>,
  Globe: <><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c-5 5-5 13 0 18 5-5 5-13 0-18Z" /></>,
  Settings: <><path d="m9 3-1 3-3 1-2 3 2 2-1 3 3 2 3-1 2 3 3-1 1-3 3-1 2-3-2-2 1-3-3-2-3 1-2-2Z" /><circle cx="12" cy="11" r="3" /></>,
  Palette: <><path d="M12 3a9 9 0 1 0 0 18h1a2 2 0 0 0 1-3.7 1 1 0 0 1 .5-1.8H17a4 4 0 0 0 4-4A8.7 8.7 0 0 0 12 3Z" /><circle cx="7.5" cy="10" r=".5" /><circle cx="10" cy="6.5" r=".5" /><circle cx="14.5" cy="7" r=".5" /><circle cx="17" cy="10.5" r=".5" /></>,
} satisfies Record<string, ReactNode>;

export type NavigationIconName = keyof typeof icons;
export default function NavigationIcon({ name, className = "h-5 w-5" }: { name: NavigationIconName; className?: string }) {
  return <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={`shrink-0 ${className}`}>
    {icons[name]}
  </svg>;
}
