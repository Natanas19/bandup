import { getSafeExternalUrl, socialPlatforms } from "@/lib/social-links";

export const PUBLIC_LINK_LIMIT = 8;
export const PUBLIC_LINK_LABEL_LIMIT = 80;
export const PUBLIC_LINK_URL_LIMIT = 2048;
export const publicLinkPlatforms = {
  spotify: socialPlatforms.spotify,
  instagram: socialPlatforms.instagram,
  youtube: socialPlatforms.youtube,
  tiktok: socialPlatforms.tiktok,
  custom: "Personalizado",
} as const;

export type PublicLinkPlatform = keyof typeof publicLinkPlatforms;

const platformHosts = {
  spotify: ["open.spotify.com"],
  instagram: ["instagram.com", "www.instagram.com"],
  youtube: ["youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be"],
  tiktok: ["tiktok.com", "www.tiktok.com", "vm.tiktok.com", "vt.tiktok.com"],
};
const dnsHost = /^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]([a-z0-9-]{0,61}[a-z0-9])?$/;
const urlSuffix = /^([/?#]([a-zA-Z0-9._~!$&'()*+,;=:@/?#-]|%[0-9a-fA-F]{2})*)?$/;
const controls = /[\u0000-\u001f\u007f]/;

export function isPublicLinkPlatform(value: unknown): value is PublicLinkPlatform {
  return typeof value === "string" && Object.hasOwn(publicLinkPlatforms, value);
}

export function isValidPublicLinkLabel(value: string): boolean {
  return !controls.test(value) && Array.from(value.trim()).length <= PUBLIC_LINK_LABEL_LIMIT;
}

export function getBandPublicLinkUrl(value: string, platform: PublicLinkPlatform): string | null {
  const parsed = /^https:\/\/([^/?#]+)(.*)$/i.exec(value.trim());
  if (!isPublicLinkPlatform(platform) || controls.test(value) || !parsed) return null;
  const hostname = parsed[1].toLowerCase();
  const suffix = parsed[2];
  const url = `https://${hostname}${suffix}`;
  if (url.length > PUBLIC_LINK_URL_LIMIT || hostname.length > 253 || !dnsHost.test(hostname) || !urlSuffix.test(suffix)) return null;
  if (platform !== "custom" && !platformHosts[platform].includes(hostname)) return null;
  return getSafeExternalUrl(url) ? url : null;
}
