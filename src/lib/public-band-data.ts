import { isLaboratoryHttpOrigin } from "./development-lab";
import { getSafeExternalUrl } from "./social-links";
import {
  getBandPublicLinkUrl, isPublicLinkPlatform, isValidPublicLinkLabel, PUBLIC_LINK_LIMIT, type PublicLinkPlatform,
} from "@/lib/public-link-url";

export type PublicBand = {
  slug: string;
  name: string;
  image: { src: string; alt: string } | null;
  description: string;
};

export type PublicBandProfileLink = {
  platform: PublicLinkPlatform;
  label: string | null;
  url: string;
  position: number;
};

function invalidResponse(): never {
  throw new Error("Não foi possível carregar a página pública.");
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isValidPublicSlug(slug: string): boolean {
  return slug.trim().length > 0 && slug.length <= 2048 && !/[\u0000-\u001f\u007f]/.test(slug);
}

export function safeBandLogo(value: string | null, origin: string): string | null {
  if (!value) return null;
  const safe = getSafeExternalUrl(value);
  if (!safe) return null;
  try {
    const url = new URL(safe);
    const labHttp = isLaboratoryHttpOrigin(url.origin);
    if (
      (url.protocol !== "https:" && !labHttp) ||
      url.origin !== new URL(origin).origin ||
      !url.pathname.startsWith("/storage/v1/object/public/") ||
      url.pathname.toLowerCase().endsWith(".svg") ||
      url.search || url.hash
    ) return null;
    return url.href;
  } catch {
    return null;
  }
}

export function safeDiscoveryAvatar(value: unknown, available: boolean, origin: string): string | null {
  if (!available || typeof value !== "string") return null;
  const url = safeBandLogo(value, origin);
  if (!url || url !== value) return null;
  const avatarPath = /^\/storage\/v1\/object\/public\/avatars\/[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(jpg|png|webp)$/;
  return avatarPath.test(new URL(url).pathname) ? url : null;
}

export function toPublicBand(
  value: unknown,
  expectedSlug: string,
  imageOrigin: string,
): PublicBand | null {
  if (value === null) return null;
  if (
    !record(value) ||
    typeof value.name !== "string" || !value.name.trim() ||
    value.slug !== expectedSlug ||
    (value.description !== null && typeof value.description !== "string") ||
    (value.logo_url !== null && typeof value.logo_url !== "string")
  ) return invalidResponse();
  const src = safeBandLogo(value.logo_url as string | null, imageOrigin);
  return {
    slug: expectedSlug,
    name: value.name.trim(),
    description: (value.description as string | null) ?? "",
    image: src ? { src, alt: `Imagem da banda ${value.name.trim()}` } : null,
  };
}

export function toPublicBandLinks(value: unknown, slug: string): PublicBandProfileLink[] {
  if (!Array.isArray(value)) return [];
  const links: PublicBandProfileLink[] = [];
  for (const row of value) {
    if (!record(row) || row.slug !== slug || !isPublicLinkPlatform(row.platform) || typeof row.url !== "string"
      || typeof row.position !== "number" || !Number.isInteger(row.position)
      || row.position < 1 || row.position > PUBLIC_LINK_LIMIT) continue;
    const url = getBandPublicLinkUrl(row.url, row.platform);
    if (!url) continue;
    const label = typeof row.label === "string" && isValidPublicLinkLabel(row.label) ? row.label.trim() || null : null;
    links.push({ platform: row.platform, label, url, position: row.position });
  }
  return links.sort((a, b) => a.position - b.position);
}
