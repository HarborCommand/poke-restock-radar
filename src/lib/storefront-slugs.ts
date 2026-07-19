export const STOREFRONT_SLUG_MAX_LENGTH = 96;

const SAFE_NAMED_ENTITIES: Record<string, string> = {
  amp: " ",
  apos: "'",
  copy: " ",
  eacute: "é",
  Eacute: "É",
  gt: " ",
  hellip: " ",
  laquo: " ",
  ldquo: '"',
  lsquo: "'",
  lt: " ",
  mdash: "-",
  nbsp: " ",
  ndash: "-",
  quot: '"',
  raquo: " ",
  rdquo: '"',
  reg: " ",
  rsquo: "'",
  trade: " "
};

const MOJIBAKE_REPLACEMENTS: Array<[RegExp, string]> = [
  [/Ã¡/g, "á"],
  [/Ã /g, "à"],
  [/Ã¢/g, "â"],
  [/Ã£/g, "ã"],
  [/Ã¤/g, "ä"],
  [/Ã¥/g, "å"],
  [/Ã¦/g, "æ"],
  [/Ã§/g, "ç"],
  [/Ã¨/g, "è"],
  [/Ã©/g, "é"],
  [/Ãª/g, "ê"],
  [/Ã«/g, "ë"],
  [/Ã­/g, "í"],
  [/Ã¬/g, "ì"],
  [/Ã®/g, "î"],
  [/Ã¯/g, "ï"],
  [/Ã±/g, "ñ"],
  [/Ã³/g, "ó"],
  [/Ã²/g, "ò"],
  [/Ã´/g, "ô"],
  [/Ã¶/g, "ö"],
  [/Ãº/g, "ú"],
  [/Ã¹/g, "ù"],
  [/Ã»/g, "û"],
  [/Ã¼/g, "ü"],
  [/Ã½/g, "ý"],
  [/Ã¿/g, "ÿ"],
  [/â€“/g, "-"],
  [/â€”/g, "-"],
  [/â€˜/g, "'"],
  [/â€™/g, "'"],
  [/â€œ/g, '"'],
  [/â€/g, '"'],
  [/â€¦/g, " "],
  [/â„¢/g, " "],
  [/Â®/g, " "],
  [/Â©/g, " "],
  [/Â /g, " "]
];

const LEGACY_NUMERIC_ENTITY_FRAGMENTS: Record<string, string> = {
  "160": " ",
  "169": " ",
  "174": " ",
  "192": "A",
  "193": "A",
  "194": "A",
  "195": "A",
  "196": "A",
  "197": "A",
  "198": "AE",
  "199": "C",
  "200": "E",
  "201": "E",
  "202": "E",
  "203": "E",
  "204": "I",
  "205": "I",
  "206": "I",
  "207": "I",
  "209": "N",
  "210": "O",
  "211": "O",
  "212": "O",
  "213": "O",
  "214": "O",
  "216": "O",
  "217": "U",
  "218": "U",
  "219": "U",
  "220": "U",
  "221": "Y",
  "223": "ss",
  "224": "a",
  "225": "a",
  "226": "a",
  "227": "a",
  "228": "a",
  "229": "a",
  "230": "ae",
  "231": "c",
  "232": "e",
  "233": "e",
  "234": "e",
  "235": "e",
  "236": "i",
  "237": "i",
  "238": "i",
  "239": "i",
  "241": "n",
  "242": "o",
  "243": "o",
  "244": "o",
  "245": "o",
  "246": "o",
  "248": "o",
  "249": "u",
  "250": "u",
  "251": "u",
  "252": "u",
  "253": "y",
  "255": "y",
  "8211": "-",
  "8212": "-",
  "8216": "'",
  "8217": "'",
  "8220": '"',
  "8221": '"',
  "8230": " ",
  "8482": " "
};

function decodeSafeHtmlEntities(value: string) {
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]+);/gi, (match, entity: string) => {
    const lower = entity.toLowerCase();
    if (lower.startsWith("#x")) {
      const codePoint = Number.parseInt(lower.slice(2), 16);
      return safeCodePointReplacement(codePoint, match);
    }
    if (lower.startsWith("#")) {
      const codePoint = Number.parseInt(lower.slice(1), 10);
      return safeCodePointReplacement(codePoint, match);
    }
    return SAFE_NAMED_ENTITIES[entity] ?? SAFE_NAMED_ENTITIES[lower] ?? match;
  });
}

function safeCodePointReplacement(codePoint: number, fallback: string) {
  if (!Number.isFinite(codePoint) || codePoint < 0 || codePoint > 0x10ffff) return fallback;
  if (
    codePoint === 0x20 ||
    codePoint === 0xa0 ||
    codePoint === 0xa9 ||
    codePoint === 0xae ||
    codePoint === 0x2013 ||
    codePoint === 0x2014 ||
    codePoint === 0x2018 ||
    codePoint === 0x2019 ||
    codePoint === 0x201c ||
    codePoint === 0x201d ||
    codePoint === 0x2026 ||
    codePoint === 0x2122 ||
    (codePoint >= 0xc0 && codePoint <= 0xff)
  ) {
    return String.fromCodePoint(codePoint);
  }
  return " ";
}

function repairMojibake(value: string) {
  return MOJIBAKE_REPLACEMENTS.reduce((current, [pattern, replacement]) => current.replace(pattern, replacement), value);
}

function decodeLegacyNumericEntityFragments(value: string) {
  return value.replace(/\d{2,5}/g, (digits, offset, fullValue) => {
    const replacement = LEGACY_NUMERIC_ENTITY_FRAGMENTS[digits];
    if (!replacement) return digits;
    const previous = fullValue[offset - 1] ?? "";
    const next = fullValue[offset + digits.length] ?? "";
    const touchesAsciiWord = /[A-Za-z]/.test(previous) || /[A-Za-z]/.test(next);
    const isTypographyFragment = replacement === " " || replacement === "-" || replacement === "'" || replacement === '"';
    return touchesAsciiWord || isTypographyFragment ? replacement : digits;
  });
}

function transliterateSpecialLetters(value: string) {
  return value
    .replace(/[™®©]/g, " ")
    .replace(/[ÆǼǢ]/g, "AE")
    .replace(/[æǽǣ]/g, "ae")
    .replace(/[Œ]/g, "OE")
    .replace(/[œ]/g, "oe")
    .replace(/[Ð]/g, "D")
    .replace(/[ð]/g, "d")
    .replace(/[Þ]/g, "Th")
    .replace(/[þ]/g, "th")
    .replace(/[Ł]/g, "L")
    .replace(/[ł]/g, "l")
    .replace(/[Ø]/g, "O")
    .replace(/[ø]/g, "o");
}

function trimSlugLength(slug: string, maxLength: number) {
  if (slug.length <= maxLength) return slug;
  const sliced = slug.slice(0, maxLength);
  const lastSeparator = sliced.lastIndexOf("-");
  const trimmed = sliced.slice(0, lastSeparator >= 40 ? lastSeparator : maxLength).replace(/^-+|-+$/g, "");
  return trimmed || sliced.replace(/^-+|-+$/g, "");
}

export function normalizeStorefrontSlug(value: string | null | undefined, fallback = "product") {
  const decoded = decodeLegacyNumericEntityFragments(repairMojibake(decodeSafeHtmlEntities(String(value ?? ""))));
  const normalized = transliterateSpecialLetters(decoded)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " ")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  return trimSlugLength(normalized, STOREFRONT_SLUG_MAX_LENGTH) || fallback;
}

export type StorefrontSlugAuditInput = {
  id: string;
  title: string | null;
  publicSlug: string | null;
  publishToStore?: boolean | null;
  storeStatus?: string | null;
};

export type StorefrontSlugAuditRow = StorefrontSlugAuditInput & {
  proposedSlug: string;
  hasStoredSlug: boolean;
  needsCorrection: boolean;
  collision: boolean;
};

export function auditStorefrontSlugs(items: StorefrontSlugAuditInput[]): StorefrontSlugAuditRow[] {
  const proposedCounts = new Map<string, number>();
  const rows = items.map((item) => {
    const proposedSlug = normalizeStorefrontSlug(item.publicSlug || item.title || "", `product-${item.id.slice(-6)}`);
    proposedCounts.set(proposedSlug, (proposedCounts.get(proposedSlug) ?? 0) + 1);
    return {
      ...item,
      proposedSlug,
      hasStoredSlug: Boolean(item.publicSlug),
      needsCorrection: Boolean(item.publicSlug && item.publicSlug !== proposedSlug),
      collision: false
    };
  });
  return rows.map((row) => ({
    ...row,
    collision: (proposedCounts.get(row.proposedSlug) ?? 0) > 1
  }));
}
