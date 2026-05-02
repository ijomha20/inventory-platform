import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";
import { pool } from "@workspace/db";
import { requireOwner } from "../lib/auth.js";
import { DEALER_COLLECTIONS, typesenseSearch } from "../lib/typesense.js";
import { loadSessionFromStore, probeBucket } from "../lib/bbObjectStore.js";
import { graphqlHealthCheck } from "../lib/lenderAuth.js";

const router: IRouter = Router();

let deepHealthCache: { at: number; payload: DeepHealthPayload } | null = null;

export interface DeepHealthPayload {
  status: string;
  checkedAt: string;
  latencyMs: number;
  dependencies: {
    db: { ok: boolean; latencyMs: number; error: string | null };
    gcs: { ok: boolean; latencyMs: number; error: string | null };
    creditApp: { ok: boolean; latencyMs: number; error: string | null };
    typesense: Array<{ collection: string; ok: boolean; status: number; latencyMs: number; error: string | null }>;
  };
}

export async function runDeepHealth(): Promise<DeepHealthPayload> {
  if (deepHealthCache && Date.now() - deepHealthCache.at < 30_000) {
    return deepHealthCache.payload;
  }

  const started = Date.now();

  let dbProbe: { ok: boolean; latencyMs: number; error: string | null } = { ok: false, latencyMs: 0, error: null };
  try {
    const t = Date.now();
    await pool.query("select 1");
    dbProbe = { ok: true, latencyMs: Date.now() - t, error: null };
  } catch (err) {
    dbProbe = { ok: false, latencyMs: 0, error: String(err) };
  }

  const typesenseProbes = await Promise.all(DEALER_COLLECTIONS.map(async (collection) => {
    const t = Date.now();
    try {
      const params = new URLSearchParams({ q: "*", per_page: "1" });
      const resp = await typesenseSearch(collection, params, 5000);
      return {
        collection: collection.name,
        ok: resp.ok,
        status: resp.status,
        latencyMs: Date.now() - t,
        error: resp.ok ? null : await resp.text(),
      };
    } catch (err) {
      return {
        collection: collection.name,
        ok: false,
        status: 0,
        latencyMs: Date.now() - t,
        error: String(err),
      };
    }
  }));

  // Use probeBucket() which actually throws on transport/auth failure, giving
  // the health check a real signal (unlike loadSessionFromStore which swallows errors).
  const gcsProbe = await (async () => {
    const t = Date.now();
    const result = await probeBucket();
    return { ok: result.ok, latencyMs: Date.now() - t, error: result.error };
  })();

  const creditAppProbe = await (async () => {
    const t = Date.now();
    try {
      const session = await loadSessionFromStore();
      if (!session?.cookies?.length) {
        return { ok: false, latencyMs: Date.now() - t, error: "No BB session cookie blob available" };
      }
      const appSession = session.cookies.find((c: any) => c?.name === "appSession")?.value ?? "";
      const csrfToken = session.cookies.find((c: any) => c?.name === "CA_CSRF_TOKEN")?.value ?? "";
      if (!appSession || !csrfToken) {
        return { ok: false, latencyMs: Date.now() - t, error: "Missing appSession/CA_CSRF_TOKEN cookie values" };
      }
      const ok = await graphqlHealthCheck(appSession, csrfToken);
      return { ok, latencyMs: Date.now() - t, error: ok ? null : "graphqlHealthCheck returned false" };
    } catch (err) {
      return { ok: false, latencyMs: Date.now() - t, error: String(err) };
    }
  })();

  const payload: DeepHealthPayload = {
    status: "ok",
    checkedAt: new Date().toISOString(),
    latencyMs: Date.now() - started,
    dependencies: {
      db: dbProbe,
      gcs: gcsProbe,
      creditApp: creditAppProbe,
      typesense: typesenseProbes,
    },
  };
  deepHealthCache = { at: Date.now(), payload };
  return payload;
}

router.get("/healthz", (_req, res) => {
  const data = HealthCheckResponse.parse({ status: "ok" });
  res.json(data);
});

router.get("/healthz/deep", requireOwner, async (_req, res) => {
  const payload = await runDeepHealth();
  res.set("Cache-Control", "no-store");
  res.json(payload);
});

export default router;
