import { Router, type IRouter } from "express";
import healthRouter    from "./health.js";
import authRouter      from "./auth.js";
import inventoryRouter from "./inventory.js";
import accessRouter    from "./access.js";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(inventoryRouter);
router.use(accessRouter);

export default router;
