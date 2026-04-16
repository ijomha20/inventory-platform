/**
 * Single source of truth for Typesense config, dealer collections, and URL helpers.
 * All Typesense consumers import from here — no duplication.
 */

export const TYPESENSE_HOST = "v6eba1srpfohj89dp-1.a1.typesense.net";

export interface DealerCollection {
  name:       string;
  collection: string;
  apiKey:     string;
  siteUrl:    string;
}

export const DEALER_COLLECTIONS: readonly DealerCollection[] = [
  {
    name:       "Parkdale",
    collection: "37042ac7ece3a217b1a41d6f54ba6855",
    apiKey:     "bENlSmdIaVJWNGhTcjBnZ3BaN2JxajBINWcvdzREZ21hQnFMZWM3OWJBRT1oZmUweyJmaWx0ZXJfYnkiOiJzdGF0dXM6W0luc3RvY2tdICYmIHZpc2liaWxpdHk6PjAgJiYgZGVsZXRlZF9hdDo9MCJ9",
    siteUrl:    "https://www.parkdalemotors.ca",
  },
  {
    name:       "Matrix",
    collection: "cebacbca97920d818d57c6f0526d7413",
    apiKey:     "ZWoxa3NxVmJLWFBOK2dWcUFBM1V0aTJyb09wUDhFZ0R5Vnc1blc2RW9Kdz1oZmUweyJmaWx0ZXJfYnkiOiJzdGF0dXM6W0luc3RvY2ssIFNvbGRdICYmIHZpc2liaWxpdHk6PjAgJiYgZGVsZXRlZF9hdDo9MCJ9",
    siteUrl:    "https://www.matrixmotorsyeg.ca",
  },
];

/** Map hostname (without www.) → DealerCollection for price-lookup matching. */
export const DEALER_BY_HOSTNAME: ReadonlyMap<string, DealerCollection> = new Map(
  DEALER_COLLECTIONS.map((d) => {
    const host = new URL(d.siteUrl).hostname.replace(/^www\./, "");
    return [host, d] as const;
  }),
);

export const IMAGE_CDN_BASE = "https://zopsoftware-asset.b-cdn.net";

/** Build a Typesense search URL for a given collection. */
export function typesenseSearchUrl(
  collection: string,
  apiKey: string,
  params: URLSearchParams,
): string {
  params.set("x-typesense-api-key", apiKey);
  return `https://${TYPESENSE_HOST}/collections/${collection}/documents/search?${params}`;
}

/**
 * Resolve a Typesense document to a dealer website listing URL.
 * Tries page_url first, then builds from slug + id.
 */
export function extractWebsiteUrl(doc: any, siteUrl: string): string | null {
  if (doc.page_url) {
    const path = doc.page_url.toString().trim().replace(/^\/+|\/+$/g, "");
    return `${siteUrl}/${path}/`;
  }
  const id   = doc.id || doc.post_id || doc.vehicle_id || "";
  let   slug = doc.slug || doc.url_slug || "";
  if (!slug && doc.year && doc.make && doc.model) {
    slug = [doc.year, doc.make, doc.model, doc.trim || ""]
      .filter((p: any) => String(p).trim() !== "")
      .join(" ").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  }
  if (!id || !slug) return null;
  return `${siteUrl}/inventory/${slug}/${id}/`;
}

/** Typed shape of a Typesense search API response. */
export interface TypesenseSearchResponse<T = Record<string, unknown>> {
  found: number;
  hits: Array<{ document: T }>;
}
