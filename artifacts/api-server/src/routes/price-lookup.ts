import { Router } from "express";
import { logger } from "../lib/logger.js";

const router = Router();

const TYPESENSE_HOST = "v6eba1srpfohj89dp-1.a1.typesense.net";

// Dealer configs: hostname → { collection, apiKey }
const DEALERS: Record<string, { collection: string; apiKey: string }> = {
  "matrixmotorsyeg.ca": {
    collection: "cebacbca97920d818d57c6f0526d7413",
    apiKey: "ZWoxa3NxVmJLWFBOK2dWcUFBM1V0aTJyb09wUDhFZ0R5Vnc1blc2RW9Kdz1oZmUweyJmaWx0ZXJfYnkiOiJzdGF0dXM6W0luc3RvY2ssIFNvbGRdICYmIHZpc2liaWxpdHk6PjAgJiYgZGVsZXRlZF9hdDo9MCJ9",
  },
  "parkdalemotors.ca": {
    collection: "37042ac7ece3a217b1a41d6f54ba6855",
    apiKey: "bENlSmdIaVJWNGhTcjBnZ3BaN2JxajBINWcvdzREZ21hQnFMZWM3OWJBRT1oZmUweyJmaWx0ZXJfYnkiOiJzdGF0dXM6W0luc3RvY2tdICYmIHZpc2liaWxpdHk6PjAgJiYgZGVsZXRlZF9hdDo9MCJ9",
  },
};

function formatPrice(n: number): string {
  return "$" + Math.round(n).toLocaleString("en-US");
}

// GET /api/price-lookup?url=<encoded_url>
router.get("/price-lookup", async (req, res) => {
  if (!req.isAuthenticated || !req.isAuthenticated()) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }

  // Never cache — prices change and we must always serve a fresh Typesense result
  res.set("Cache-Control", "no-store");

  const url = (req.query.url as string ?? "").trim();
  if (!url || !url.startsWith("http")) {
    res.status(400).json({ error: "Invalid URL" });
    return;
  }

  try {
    const parsed = new URL(url);

    // Match dealer by hostname (strip www.)
    const hostname = parsed.hostname.replace(/^www\./, "");
    const dealer = DEALERS[hostname];

    if (!dealer) {
      // Unknown dealer — fall back to null (no scraping attempt)
      res.json({ price: null });
      return;
    }

    // Extract numeric document ID from URL path: e.g. /inventory/2017-subaru-wrx/1535/
    const idMatch = parsed.pathname.match(/\/(\d+)\/?$/);
    if (!idMatch) {
      res.json({ price: null });
      return;
    }
    const docId = idMatch[1];

    // Query Typesense via search endpoint (search key doesn't allow direct document fetch)
    const params = new URLSearchParams({
      q: "*",
      filter_by: `id:=[${docId}]`,
      per_page: "1",
      "x-typesense-api-key": dealer.apiKey,
    });
    const tsUrl = `https://${TYPESENSE_HOST}/collections/${dealer.collection}/documents/search?${params}`;
    const tsRes = await fetch(tsUrl, {
      signal: AbortSignal.timeout(5000),
    });

    if (!tsRes.ok) {
      logger.warn({ status: tsRes.status, url, docId }, "Typesense lookup failed");
      res.json({ price: null });
      return;
    }

    const body = await tsRes.json() as { hits?: Array<{ document: Record<string, unknown> }> };
    if (!body.hits || body.hits.length === 0) {
      res.json({ price: null });
      return;
    }
    const doc = body.hits[0].document;

    // Use special_price if active, otherwise regular price
    const specialOn = Number(doc.special_price_on) === 1;
    const specialPrice = Number(doc.special_price);
    const regularPrice = Number(doc.price);

    const rawPrice = specialOn && specialPrice > 0 ? specialPrice : regularPrice;

    if (!rawPrice || rawPrice <= 0) {
      res.json({ price: null });
      return;
    }

    res.json({ price: formatPrice(rawPrice) });
  } catch (err) {
    logger.warn({ err, url }, "price-lookup error");
    res.json({ price: null });
  }
});

export default router;
