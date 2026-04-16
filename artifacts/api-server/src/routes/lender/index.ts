import { Router } from "express";
import readRouter from "./lender-read.js";
import calculateRouter from "./lender-calculate.js";
import adminRouter from "./lender-admin.js";

const router = Router();
router.use(readRouter);
router.use(calculateRouter);
router.use(adminRouter);
export default router;
