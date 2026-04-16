import { Router } from "express";
import { requireOwner } from "../../lib/auth.js";
import { logger } from "../../lib/logger.js";
import {
  getLenderSyncStatus,
  runLenderSync,
} from "../../lib/lenderWorker.js";

const router = Router();

router.post("/refresh-lender", requireOwner, async (_req, res) => {
  const s = getLenderSyncStatus();
  if (s.running) {
    res.json({ ok: false, message: "Already running", running: true });
    return;
  }
  const { LENDER_ENABLED } = await import("../../lib/lenderAuth.js");
  if (!LENDER_ENABLED) {
    res.json({ ok: false, message: "Lender credentials not configured", running: false });
    return;
  }
  runLenderSync().catch((err) =>
    logger.error({ err }, "Manual lender sync error"),
  );
  res.json({ ok: true, message: "Lender sync started", running: true });
});

export default router;
