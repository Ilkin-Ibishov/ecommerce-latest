import { createClient } from "@supabase/supabase-js";

const admin = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

/**
 * Deletes all test data associated with a user in dependency order,
 * then removes the auth user via the Supabase admin API.
 *
 * Best-effort: logs warnings on failure but does not throw.
 */
export async function cleanupTestUser(userId: string): Promise<void> {
  try {
    // 1. Delete order_items for all orders belonging to this user
    const { data: orders } = await admin
      .from("orders")
      .select("id")
      .eq("user_id", userId);

    const orderIds = orders?.map((o) => o.id) ?? [];

    if (orderIds.length > 0) {
      const { error: orderItemsError } = await admin
        .from("order_items")
        .delete()
        .in("order_id", orderIds);

      if (orderItemsError) {
        console.warn(
          `[cleanup] Failed to delete order_items for user ${userId}:`,
          orderItemsError.message
        );
      }
    }

    // 2. Delete orders
    const { error: ordersError } = await admin
      .from("orders")
      .delete()
      .eq("user_id", userId);

    if (ordersError) {
      console.warn(
        `[cleanup] Failed to delete orders for user ${userId}:`,
        ordersError.message
      );
    }

    // 3. Delete cart_items
    const { error: cartError } = await admin
      .from("cart_items")
      .delete()
      .eq("user_id", userId);

    if (cartError) {
      console.warn(
        `[cleanup] Failed to delete cart_items for user ${userId}:`,
        cartError.message
      );
    }

    // 4. Delete coupon_usages
    const { error: couponUsagesError } = await admin
      .from("coupon_usages")
      .delete()
      .eq("user_id", userId);

    if (couponUsagesError) {
      console.warn(
        `[cleanup] Failed to delete coupon_usages for user ${userId}:`,
        couponUsagesError.message
      );
    }

    // 5. Delete the auth user
    const { error: deleteUserError } =
      await admin.auth.admin.deleteUser(userId);

    if (deleteUserError) {
      console.warn(
        `[cleanup] Failed to delete auth user ${userId}:`,
        deleteUserError.message
      );
    }
  } catch (error) {
    console.warn(
      `[cleanup] Unexpected error cleaning up user ${userId}:`,
      error instanceof Error ? error.message : error
    );
  }
}

/**
 * Deletes a test coupon and its associated usages.
 *
 * Best-effort: logs warnings on failure but does not throw.
 */
export async function cleanupTestCoupon(couponId: string): Promise<void> {
  try {
    // 1. Delete coupon_usages referencing this coupon
    const { error: usagesError } = await admin
      .from("coupon_usages")
      .delete()
      .eq("coupon_id", couponId);

    if (usagesError) {
      console.warn(
        `[cleanup] Failed to delete coupon_usages for coupon ${couponId}:`,
        usagesError.message
      );
    }

    // 2. Delete the coupon itself
    const { error: couponError } = await admin
      .from("coupons")
      .delete()
      .eq("id", couponId);

    if (couponError) {
      console.warn(
        `[cleanup] Failed to delete coupon ${couponId}:`,
        couponError.message
      );
    }
  } catch (error) {
    console.warn(
      `[cleanup] Unexpected error cleaning up coupon ${couponId}:`,
      error instanceof Error ? error.message : error
    );
  }
}
