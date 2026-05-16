import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import ordersRouter from "./orders";
import couponsRouter from "./coupons";
import adminRouter from "./admin";
import wishlistRouter from "./wishlist";
import commentsRouter from "./comments";
import cartRouter from "./cart";
import bootstrapRouter from "./bootstrap";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(ordersRouter);
router.use(couponsRouter);
router.use(adminRouter);
router.use(wishlistRouter);
router.use(commentsRouter);
router.use(cartRouter);
router.use(bootstrapRouter);

export default router;
