export type ProductSearchCandidate = {
  title: string;
  brand?: string | null;
  category?: string | null;
  imageUrl?: string | null;
  retailer?: string | null;
  productUrl?: string | null;
  price?: number | null;
  sku?: string | null;
  tcin?: string | null;
  upc?: string | null;
  source: string;
  confidence: number;
};

export type ProductSearchFailure = {
  source: string;
  reason: string;
  configured?: boolean;
  statusCode?: number;
  detail?: string;
};

export type ProductSearchConfig = {
  provider: string | null;
  apiUrl: string | null;
  apiKeyConfigured: boolean;
  configured: boolean;
};

export type ProductSearchResult = {
  configured: boolean;
  provider: string | null;
  candidates: ProductSearchCandidate[];
  failures: ProductSearchFailure[];
};

