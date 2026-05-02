/**
 * Lender router barrel — mounts lender sub-routers.
 * All lender routes require owner access; enforcement is applied
 * per-route inside each sub-router via requireOwner middleware.
 *   lender-read.ts      — GET /lender-programs, GET /lender-status
 *   lender-calculate.ts — POST /lender-calculate
 *   lender-admin.ts     — POST /refresh-lender, GET /lender-debug
 */
import { Router } from "express";
import readRouter from "./lender-read.js";
import calculateRouter from "./lender-calculate.js";
import adminRouter from "./lender-admin.js";

const router = Router();
router.use(readRouter);
router.use(calculateRouter);
router.use(adminRouter);
export default router;
