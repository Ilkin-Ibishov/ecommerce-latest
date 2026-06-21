/**
 * Notifications proxy route — called BY the store frontend (user-authed).
 *
 * The store frontend calls `GET /platform/notifications` with the user's JWT.
 * This proxy validates the user, then forwards to the Control_Plane store-feed
 * using the server-side STORE_PLATFORM_SECRET — the secret never reaches the
 * client bundle.
 *
 * Feature: security-hardening
 * Requirements: 2.1, 2.2, 2.3, 2.4, 2.5
 */
import { Router, type IRouter } from "express";
import { requireUser } from "../../middlewares/requireUser";

const router: IRouter = Router();

router.get(
  "/platform/notifications",
  requireUser,
  async (req, res): Promise<void> => {
    const secret = process.env.STORE_PLATFORM_SECRET;
    if (!secret) {
      res.status(503).json({ error: "Service unavailable" });
      return;
    }

    const upstreamUrl = `${process.env.PLATFORM_CONTROL_PLANE_URL}/api/store-feed`;

    const response = await fetch(upstreamUrl, {
      headers: {
        Authorization: `Bearer ${secret}`,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      res.status(response.status).json({ error: "Upstream error" });
      return;
    }

    const data = await response.json();
    res.json(data);
  },
);

export default router;
