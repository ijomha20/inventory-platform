import { Router } from "express";
import { requireOwner } from "../lib/auth.js";
import { runCarfaxWorkerForVins, runCarfaxWorker, getCarfaxBatchStatus } from "../lib/carfaxWorker.js";
import { logger } from "../lib/logger.js";

const router = Router();

router.get("/carfax/batch-status", requireOwner, (_req, res) => {
  res.json(getCarfaxBatchStatus());
});

router.post("/carfax/run-batch", requireOwner, (req: any, res: any) => {
  const status = getCarfaxBatchStatus();
  if (status.running) {
    res.status(409).json({ ok: false, error: "A batch is already running", startedAt: status.startedAt });
    return;
  }
  logger.info({ requestedBy: (req.user as any)?.email }, "Manual Carfax batch triggered via API");
  runCarfaxWorker({ force: true }).catch((err) =>
    logger.error({ err }, "Manual Carfax batch failed")
  );
  res.json({ ok: true, message: "Carfax batch started. Check server logs for progress." });
});

router.post("/carfax/test", requireOwner, async (req: any, res: any) => {
  const { vins } = req.body as { vins?: string[] };

  if (!Array.isArray(vins) || vins.length === 0) {
    res.status(400).json({ error: "Provide an array of VINs in the request body: { vins: [...] }" });
    return;
  }

  if (vins.length > 10) {
    res.status(400).json({ error: "Maximum 10 VINs per test run" });
    return;
  }

  const cleanVins = vins.map((v) => String(v).trim().toUpperCase()).filter(Boolean);
  logger.info({ vins: cleanVins, requestedBy: (req.user as any)?.email }, "Carfax test run requested via API");

  try {
    const results = await runCarfaxWorkerForVins(cleanVins);
    res.json({ ok: true, results });
  } catch (err: any) {
    logger.error({ err }, "Carfax test endpoint error");
    res.status(500).json({ ok: false, error: err.message });
  }
});

export default router;
