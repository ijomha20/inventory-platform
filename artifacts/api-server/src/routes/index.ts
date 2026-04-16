import { Router, type IRouter } from "express";
import healthRouter    from "./health.js";
import authRouter      from "./auth.js";
import inventoryRouter from "./inventory.js";
import accessRouter    from "./access.js";
import carfaxRouter    from "./carfax.js";
import lenderRouter      from "./lender/index.js";
import priceLookupRouter from "./price-lookup.js";
import opsRouter         from "./ops.js";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(inventoryRouter);
router.use(accessRouter);
router.use(carfaxRouter);
router.use(lenderRouter);
router.use(priceLookupRouter);
router.use(opsRouter);

export default router;
