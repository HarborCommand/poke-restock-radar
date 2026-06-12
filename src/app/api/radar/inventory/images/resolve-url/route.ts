import { z } from "zod";
import { requireAdmin, requireUser } from "@/lib/auth";
import { badRequest, ok, readJson } from "@/lib/http";
import { extractPublicImageUrlFromHtml, isLikelyDirectProductImageUrl } from "@/lib/image-url-resolver";
import { sanitizePublicImageUrl } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const maxHtmlCharacters = 1_500_000;

const resolveImageUrlSchema = z.object({
  url: z
    .string()
    .trim()
    .min(8, "Paste a product page URL or direct image URL.")
    .max(2048, "Image source URL is too long.")
});

function validateFetchUrl(value: string) {
  const sanitized = sanitizePublicImageUrl(value, "url").value;
  if (!sanitized || sanitized.startsWith("/")) throw new Error("Use a full http/https product page URL.");
  const url = new URL(sanitized);
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("Use a full http/https product page URL.");
  return url.toString();
}

async function fetchWithTimeout(url: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    return await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        accept: "text/html,application/xhtml+xml,application/ld+json,image/avif,image/webp,image/png,image/jpeg;q=0.9,*/*;q=0.8",
        "user-agent": "GameDayGrabs image resolver (+https://www.gamedaygrabs.com)"
      }
    });
  } finally {
    clearTimeout(timeout);
  }
}

export async function POST(request: Request) {
  const { user, response } = await requireUser();
  if (response) return response;
  const adminResponse = requireAdmin(user);
  if (adminResponse) return adminResponse;

  try {
    const input = resolveImageUrlSchema.parse(await readJson(request));
    const sourceUrl = validateFetchUrl(input.url);

    if (isLikelyDirectProductImageUrl(sourceUrl)) {
      return ok({ found: true, imageUrl: sourceUrl, source: "direct_image", sourceUrl });
    }

    const response = await fetchWithTimeout(sourceUrl);
    const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
    const finalUrl = response.url || sourceUrl;

    if (!response.ok) {
      return ok({
        found: false,
        message: `Could not load this page (${response.status}). Paste a direct image URL or upload an image.`,
        source: "page_fetch",
        sourceUrl,
        finalUrl,
        status: response.status
      });
    }

    if (contentType.startsWith("image/")) {
      const imageUrl = sanitizePublicImageUrl(finalUrl, "imageUrl").value;
      return imageUrl
        ? ok({ found: true, imageUrl, source: "direct_image", sourceUrl, finalUrl })
        : ok({ found: false, message: "This image URL cannot be saved. Upload the image file instead.", source: "direct_image", sourceUrl, finalUrl });
    }

    if (!contentType.includes("html") && !contentType.includes("json") && contentType) {
      return ok({
        found: false,
        message: "This URL did not return a product page we can inspect. Paste a direct image URL or upload an image.",
        source: "unsupported_content",
        sourceUrl,
        finalUrl,
        contentType
      });
    }

    const html = (await response.text()).slice(0, maxHtmlCharacters);
    const imageUrl = extractPublicImageUrlFromHtml(html, finalUrl);
    return imageUrl
      ? ok({ found: true, imageUrl, source: "page_metadata", sourceUrl, finalUrl })
      : ok({
          found: false,
          message: "Could not find an image from this page. Paste a direct image URL or upload an image.",
          source: "page_metadata",
          sourceUrl,
          finalUrl
        });
  } catch (error) {
    return badRequest(error);
  }
}
