import type { Prisma } from "@prisma/client";

export const canonicalPosPlatforms = ["pos", "POS", "manual_pos", "MANUAL_POS"] as const;

export function canonicalPosPlatformWhere(): Prisma.StringFilter<"InventorySale"> {
  return { in: [...canonicalPosPlatforms] };
}

export function isCanonicalPosPlatform(platform: string | null | undefined) {
  return Boolean(platform && canonicalPosPlatforms.includes(platform as (typeof canonicalPosPlatforms)[number]));
}
