import { isLaboratoryHttpOrigin } from "./development-lab";
import {
  getSafeExternalUrl,
  socialPlatforms,
  type PublicSocialLink,
  type SocialPlatform,
} from "./social-links";

export type PublicBand = {
  slug: string;
  name: string;
  image: { src: string; alt: string } | null;
  description: string;
  links: readonly PublicSocialLink[];
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

function safeImage(value: string | null, origin: string): string | null {
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
    (value.logo_url !== null && typeof value.logo_url !== "string") ||
    !Array.isArray(value.links)
  ) return invalidResponse();

  const links: PublicSocialLink[] = [];
  for (const entry of value.links) {
    if (!record(entry) || typeof entry.platform !== "string" || typeof entry.url !== "string") {
      return invalidResponse();
    }
    const url = getSafeExternalUrl(entry.url);
    if (!url) continue;
    const platform: SocialPlatform = Object.prototype.hasOwnProperty.call(socialPlatforms, entry.platform)
      ? entry.platform as SocialPlatform
      : "other";
    const customLabel = platform === "other" && entry.platform !== "other"
      ? entry.platform.trim() : "";
    links.push({ id: `public-link-${links.length}`, platform, url,
      ...(customLabel ? { label: customLabel } : {}) });
  }
  const src = safeImage(value.logo_url as string | null, imageOrigin);
  return {
    slug: expectedSlug,
    name: value.name.trim(),
    description: (value.description as string | null) ?? "",
    image: src ? { src, alt: `Imagem da banda ${value.name.trim()}` } : null,
    links,
  };
}
