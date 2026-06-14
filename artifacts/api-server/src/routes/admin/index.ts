import { Router, type IRouter } from "express";
import products from "./products";
import banners from "./banners";
import orders from "./orders";
import categories from "./categories";
import coupons from "./coupons";
import whatsapp from "./whatsapp";
import users from "./users";
import settings from "./settings";
import comments from "./comments";

const router: IRouter = Router();

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
