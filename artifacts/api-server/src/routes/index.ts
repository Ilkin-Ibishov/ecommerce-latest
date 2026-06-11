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
import devRouter from "./dev";
import searchRouter from "./search";
import productsRouter from "./products";
import migrationRouter from "./migration";
import bannersRouter from "./banners";
import categoriesRouter from "./categories";
import profileRouter from "./profile";
import siteSettingsRouter from "./site-settings";
import pagesRouter from "./pages";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(profileRouter);
router.use(ordersRouter);
router.use(couponsRouter);
router.use(adminRouter);
router.use(wishlistRouter);
router.use(commentsRouter);
router.use(cartRouter);
router.use(bootstrapRouter);
router.use(productsRouter);
router.use(searchRouter);
router.use(migrationRouter);
router.use(bannersRouter);
router.use(categoriesRouter);
router.use(siteSettingsRouter);
router.use(pagesRouter);

// Dev/test routes — only active outside production
if (process.env.NODE_ENV !== "production") {
  router.use(devRouter);
}

export default router;
