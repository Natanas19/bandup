import type { ReactNode } from "react";

// Same lightweight, currentColor SVG approach as SocialPlatformIcon.
const icons = {
  ArrowUpRight: <path d="M7 17 17 7M7 7h10v10" />,
  Copy: <><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" /></>,
  Eye: <><path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6Z" /><circle cx="12" cy="12" r="2.5" /></>,
  EyeOff: <><path d="m3 3 18 18M10.6 6.1A10.9 10.9 0 0 1 12 6c6.5 0 10 6 10 6a15 15 0 0 1-2.9 3.3M6.2 7.8A15.2 15.2 0 0 0 2 12s3.5 6 10 6a10 10 0 0 0 4.1-.9" /><path d="M10.2 10.2a2.5 2.5 0 0 0 3.6 3.6" /></>,
  Share: <><path d="M12 15V3m-4 4 4-4 4 4M5 11v8a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-8" /></>,
  Ellipsis: <><circle cx="5" cy="12" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /></>,
  LayoutDashboard: <><rect x="3" y="3" width="7" height="9" rx="1" /><rect x="14" y="3" width="7" height="5" rx="1" /><rect x="14" y="12" width="7" height="9" rx="1" /><rect x="3" y="16" width="7" height="5" rx="1" /></>,
  ListTodo: <><path d="m3 6 2 2 4-4M13 6h8M13 12h8M13 18h8" /><rect x="3" y="11" width="5" height="5" rx="1" /><path d="M3 21h5" /></>,
  CalendarDays: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M16 3v4M8 3v4M3 11h18M8 15h.01M12 15h.01M16 15h.01M8 18h.01M12 18h.01M16 18h.01" /></>,
  Users: <><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" /><circle cx="9" cy="7" r="4" /></>,
  Link: <><path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-2 2M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l2-2" /></>,
  Globe: <><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c-5 5-5 13 0 18 5-5 5-13 0-18Z" /></>,
  Settings: <><path d="m9 3-1 3-3 1-2 3 2 2-1 3 3 2 3-1 2 3 3-1 1-3 3-1 2-3-2-2 1-3-3-2-3 1-2-2Z" /><circle cx="12" cy="11" r="3" /></>,
  Bell: <><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" /></>,
  ShieldCheck: <><path d="M12 22s8-4 8-11V5l-8-3-8 3v6c0 7 8 11 8 11Z" /><path d="m9 12 2 2 4-4" /></>,
  LogOut: <><path d="M10 17l5-5-5-5M15 12H3" /><path d="M12 3h5a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-5" /></>,
  Plus: <><path d="M12 5v14M5 12h14" /></>,
  Search: <><circle cx="10.8" cy="10.8" r="6.8" /><path d="m16 16 4 4" /></>,
  Store: <><path d="M3 10h18M5 10v10h14V10M3 10l1-6h16l1 6M9 20v-6h6v6" /></>,
  Ticket: <><path d="M3 5h18v5a2 2 0 0 0 0 4v5H3v-5a2 2 0 0 0 0-4V5Z" /><path d="M13 5v2m0 3v2m0 3v2" /></>,
  Music: <><path d="M9 18V5l11-2v13M9 9l11-2" /><ellipse cx="6" cy="18" rx="3" ry="2" /><ellipse cx="17" cy="16" rx="3" ry="2" /></>,
  Image: <><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><path d="m21 15-5-5L5 21" /></>,
  Palette: <><path d="M12 3a9 9 0 1 0 0 18h1a2 2 0 0 0 1-3.7 1 1 0 0 1 .5-1.8H17a4 4 0 0 0 4-4A8.7 8.7 0 0 0 12 3Z" /><circle cx="7.5" cy="10" r=".5" /><circle cx="10" cy="6.5" r=".5" /><circle cx="14.5" cy="7" r=".5" /><circle cx="17" cy="10.5" r=".5" /></>,
} satisfies Record<string, ReactNode>;

export type NavigationIconName = keyof typeof icons;
export default function NavigationIcon({ name, className = "h-5 w-5" }: { name: NavigationIconName; className?: string }) {
  return <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={`shrink-0 ${className}`}>
    {icons[name]}
  </svg>;
}
