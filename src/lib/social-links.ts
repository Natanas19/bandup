export const socialPlatforms = {
  spotify: "Spotify",
  youtube: "YouTube",
  instagram: "Instagram",
  tiktok: "TikTok",
  facebook: "Facebook",
  website: "Site oficial",
  other: "Outro link",
} as const;

export type SocialPlatform = keyof typeof socialPlatforms;

export type PublicSocialLink = {
  id: string;
  platform: SocialPlatform;
  label?: string;
  url: string;
};

export function getSafeExternalUrl(value: string): string | null {
  if (/[\u0000-\u001f\u007f]/.test(value)) return null;
  try {
    const trimmed = value.trim();
    if (!/^https?:\/\//i.test(trimmed)) return null;
    const url = new URL(trimmed);
    if (
      !["https:", "http:"].includes(url.protocol) ||
      !url.hostname ||
      url.username ||
      url.password
    ) {
      return null;
    }
    return url.href;
  } catch {
    return null;
  }
}
