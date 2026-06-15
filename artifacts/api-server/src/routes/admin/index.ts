import { Router, type IRouter } from "express";
import { platformStatus } from "../../middlewares/platformStatus";
import products from "./products";
import banners from "./banners";
import orders from "./orders";
import categories from "./categories";
import coupons from "./coupons";
import whatsapp from "./whatsapp";
import users from "./users";
import settings from "./settings";
import comments from "./comments";
import usage from "./usage";

const router: IRouter = Router();

// Wire platform-status gate on all admin routes:
// - GET/HEAD/OPTIONS → admin_read (allowed while suspended)
// - POST/PUT/PATCH/DELETE → admin_write (blocked while suspended)
router.use((req, res, next) => {
  const method = req.method.toUpperCase();
  const isRead = method === "GET" || method === "HEAD" || method === "OPTIONS";
  const gate = platformStatus(isRead ? "admin_read" : "admin_write");
  gate(req, res, next);
});

// Usage route (GET only, admin_read gated) — registered before param routes
router.use(usage);
router.use(products);
router.use(banners);
router.use(orders);
router.use(categories);
router.use(coupons);
router.use(whatsapp);
router.use(users);
router.use(settings);
router.use(comments);

export default router;
