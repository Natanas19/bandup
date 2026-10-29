import type { SocialPlatform } from "@/lib/social-links";

const paths: Record<SocialPlatform, string> = {
  spotify: "M4 8c5-2 11-2 16 1M5 12c4-2 9-2 14 1M7 16c3-1 6-1 10 1",
  youtube: "M9 8l7 4-7 4V8ZM3 7v10a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2Z",
  instagram: "M7 3h10a4 4 0 0 1 4 4v10a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4V7a4 4 0 0 1 4-4ZM16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0ZM17 7h.01",
  tiktok: "M14 3v13a4 4 0 1 1-4-4M14 3c0 4 3 6 6 6",
  facebook: "M14 21V11h4l1-4h-5V5a2 2 0 0 1 2-2h3M9 21V11H6V7h3V5a5 5 0 0 1 5-5h5",
  website: "M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0ZM3 12h18M12 3c-5 5-5 13 0 18 5-5 5-13 0-18Z",
  other: "M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-2 2M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l2-2",
};

export default function SocialPlatformIcon({ platform }: { platform: SocialPlatform }) {
  return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6">
    <path d={paths[platform]} />
  </svg>;
}
