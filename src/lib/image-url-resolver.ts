import { sanitizePublicImageUrl } from "@/lib/validation";

const imageMetaNames = new Set(["og:image", "og:image:secure_url", "twitter:image", "twitter:image:src"]);
const imageExtensionPattern = /\.(?:jpe?g|png|webp)(?:[?#].*)?$/i;

function decodeHtmlEntities(value: string) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function attributeValue(tag: string, name: string) {
  const match = tag.match(new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, "i"));
  return decodeHtmlEntities(match?.[2] ?? match?.[3] ?? match?.[4] ?? "").trim();
}

function normalizeCandidate(candidate: string, baseUrl: string) {
  const decoded = decodeHtmlEntities(candidate).trim();
  if (!decoded || /^data:image\//i.test(decoded)) return null;
  try {
    const absoluteUrl = new URL(decoded, baseUrl).toString();
    return sanitizePublicImageUrl(absoluteUrl, "imageUrl").value ?? null;
  } catch {
    return sanitizePublicImageUrl(decoded, "imageUrl").value ?? null;
  }
}

export function isLikelyDirectProductImageUrl(value: string) {
  const sanitized = sanitizePublicImageUrl(value, "imageUrl").value;
  if (!sanitized) return false;
  if (sanitized.startsWith("/") && !sanitized.startsWith("//")) return imageExtensionPattern.test(sanitized);
  try {
    const url = new URL(sanitized);
    return imageExtensionPattern.test(url.pathname);
  } catch {
    return false;
  }
}

export function extractPublicImageUrlFromHtml(html: string, pageUrl: string) {
  const metaTags = html.match(/<meta\b[^>]*>/gi) ?? [];
  for (const tag of metaTags) {
    const name = (attributeValue(tag, "property") || attributeValue(tag, "name")).toLowerCase();
    if (!imageMetaNames.has(name)) continue;
    const content = attributeValue(tag, "content");
    const imageUrl = normalizeCandidate(content, pageUrl);
    if (imageUrl) return imageUrl;
  }

  const jsonLdTags = html.match(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi) ?? [];
  for (const script of jsonLdTags) {
    const matches = script.matchAll(/"image"\s*:\s*(?:"([^"]+)"|\[\s*"([^"]+)")/gi);
    for (const match of matches) {
      const imageUrl = normalizeCandidate(match[1] ?? match[2] ?? "", pageUrl);
      if (imageUrl) return imageUrl;
    }
  }

  const embeddedImageMatches = html.matchAll(/https?:\\?\/\\?\/[^"'<>\\\s]+?\.(?:jpe?g|png|webp)(?:\?[^"'<>\\\s]*)?/gi);
  for (const match of embeddedImageMatches) {
    const imageUrl = normalizeCandidate(match[0].replaceAll("\\/", "/"), pageUrl);
    if (imageUrl) return imageUrl;
  }

  return null;
}
