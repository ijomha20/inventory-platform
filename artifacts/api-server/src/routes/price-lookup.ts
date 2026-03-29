import { Router } from "express";
import { logger } from "../lib/logger.js";

const router = Router();

// Extracts a retail price from raw HTML using multiple strategies
function extractPrice(html: string): string | null {
  // 1. JSON-LD structured data (most reliable)
  const ldMatches = html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi);
  for (const match of ldMatches) {
    try {
      const obj = JSON.parse(match[1]);
      const candidates = Array.isArray(obj) ? obj : [obj];
      for (const c of candidates) {
        const price =
          c?.offers?.price ??
          c?.offers?.[0]?.price ??
          c?.price ??
          null;
        if (price && !isNaN(Number(price))) {
          return formatPrice(Number(price));
        }
      }
    } catch { /* not valid JSON */ }
  }

  // 2. Common meta tags
  const metaPatterns = [
    /property=["']og:price:amount["'][^>]*content=["']([0-9,. ]+)["']/i,
    /name=["']twitter:data1["'][^>]*content=["']\$?([0-9,. ]+)["']/i,
    /property=["']product:price:amount["'][^>]*content=["']([0-9,. ]+)["']/i,
  ];
  for (const pattern of metaPatterns) {
    const m = html.match(pattern);
    if (m) {
      const n = parseRaw(m[1]);
      if (n) return formatPrice(n);
    }
  }

  // 3. Common dealer data attributes / inline patterns
  const attrPatterns = [
    /data-price=["']([0-9,. ]+)["']/i,
    /data-retail-price=["']([0-9,. ]+)["']/i,
    /"price"\s*:\s*"?\$?([0-9,]+(?:\.[0-9]{1,2})?)"?/i,
    /"listPrice"\s*:\s*"?\$?([0-9,]+(?:\.[0-9]{1,2})?)"?/i,
    /"retailPrice"\s*:\s*"?\$?([0-9,]+(?:\.[0-9]{1,2})?)"?/i,
    /"msrp"\s*:\s*"?\$?([0-9,]+(?:\.[0-9]{1,2})?)"?/i,
    /"salePrice"\s*:\s*"?\$?([0-9,]+(?:\.[0-9]{1,2})?)"?/i,
  ];
  for (const pattern of attrPatterns) {
    const m = html.match(pattern);
    if (m) {
      const n = parseRaw(m[1]);
      if (n && n > 500 && n < 500000) return formatPrice(n);
    }
  }

  return null;
}

function parseRaw(s: string): number | null {
  const n = parseFloat(s.replace(/,/g, "").trim());
  return isNaN(n) ? null : n;
}

function formatPrice(n: number): string {
  return "$" + Math.round(n).toLocaleString("en-US");
}

// GET /api/price-lookup?url=<encoded_url>
router.get("/price-lookup", async (req, res) => {
  if (!req.isAuthenticated || !req.isAuthenticated()) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }

  const url = (req.query.url as string ?? "").trim();
  if (!url || !url.startsWith("http")) {
    res.status(400).json({ error: "Invalid URL" });
    return;
  }

  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; InventoryBot/1.0)",
        "Accept": "text/html,application/xhtml+xml",
      },
      signal: AbortSignal.timeout(8000),
    });

    if (!response.ok) {
      res.json({ price: null });
      return;
    }

    const html = await response.text();
    const price = extractPrice(html);
    res.json({ price });
  } catch (err) {
    logger.warn({ err, url }, "price-lookup failed");
    res.json({ price: null });
  }
});

export default router;
