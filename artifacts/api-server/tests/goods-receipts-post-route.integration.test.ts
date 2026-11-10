import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@workspace/supabase-types";
import { loginTestUser, type AuthSession } from "./helpers/auth.js";
import { cleanupTestUser } from "./helpers/cleanup.js";
import { generatePhone } from "./helpers/isolation.js";

/**
 * Goods Receipts Post Route Integration Test (M2a F1 Fix Verification).
 *
 * Spec: docs/tasks/warehouse-m2a-receiving-cost.md (§12)
 * Finding: F1 — Express route POST /admin/receipts/:id/post calling post_goods_receipt
 *          via getAdminSupabase() (service role) must succeed without 42501 Forbidden.
 *
 * Runs in CI `integration-e2e` via vitest --project api-integration.
 * Requires live Supabase credentials and a running API server on port 5000.
 */
const BASE_URL = process.env.API_URL || "http://localhost:5000";

describe("Goods Receipts Post Route & Service-Role RPC (api-integration)", () => {
  let serviceClient: SupabaseClient<Database>;
  let adminSession: AuthSession | null = null;
  let testVariantId: string;
  let testProductId: string;
  let testSupplierId: string;
  let testReceiptId: string;

  beforeAll(async () => {
    const url = process.env.SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !serviceKey) {
      throw new Error("Missing required Supabase credentials in environment");
    }

    serviceClient = createClient<Database>(url, serviceKey);

    // 1. Provision an admin session for testing the Express route
    const adminPhone = generatePhone();
    adminSession = await loginTestUser(BASE_URL, adminPhone);
    // Promote via the service role so requireAdmin's users.role lookup resolves
    // (same pattern as sec005-007-p2.integration.test.ts).
    await (serviceClient as any).from("users").update({ role: "admin" }).eq("id", adminSession.userId);

    // 2. Create prerequisite supplier, product, variant
    const { data: supplier, error: supErr } = await (serviceClient as any)
      .from("suppliers")
      .insert({ name: `Test Supplier ${Date.now()}` })
      .select("id")
      .single();
    if (supErr || !supplier) throw new Error(`Failed to create test supplier: ${supErr?.message}`);
    testSupplierId = supplier.id;

    const { data: product, error: prodErr } = await (serviceClient as any)
      .from("products")
      .insert({ slug: `receipt-int-${Date.now()}`, price: 25.0, stock: 0 })
      .select("id")
      .single();
    if (prodErr || !product) throw new Error(`Failed to create test product: ${prodErr?.message}`);
    testProductId = product.id;

    // A real ledger movement (posted below) can never be deleted — stock_movements
    // is append-only by design (see trg_stock_movements_immutable). So this test's
    // product/variant can never be fully cleaned up in afterAll once the receipt
    // actually posts, and ends up as a permanent row in the test project. Give it
    // a translation now so it never breaks a storefront E2E test that happens to
    // list or link to it (az is the locale those tests use).
    await (serviceClient as any)
      .from("product_translations")
      .insert({ product_id: testProductId, lang_code: "az", title: "Qəbz Test Məhsulu" });

    const { data: variant, error: varErr } = await (serviceClient as any)
      .from("product_variants")
      .insert({ product_id: testProductId, sku: `RCPT-INT-${Date.now()}`, price: 25.0, on_hand: 0 })
      .select("id")
      .single();
    if (varErr || !variant) throw new Error(`Failed to create test variant: ${varErr?.message}`);
    testVariantId = variant.id;

    // 3. Create draft receipt and line with cost
    const { data: receipt, error: rcptErr } = await (serviceClient as any)
      .from("goods_receipts")
      .insert({
        receipt_number: `GR-INT-${Date.now()}`,
        supplier_id: testSupplierId,
        status: "draft",
        created_by: adminSession.userId,
      })
      .select("id")
      .single();
    if (rcptErr || !receipt) throw new Error(`Failed to create test receipt: ${rcptErr?.message}`);
    testReceiptId = receipt.id;

    const { data: line, error: lineErr } = await (serviceClient as any)
      .from("goods_receipt_lines")
      .insert({
        receipt_id: testReceiptId,
        variant_id: testVariantId,
        quantity: 10,
        sort_order: 0,
      })
      .select("id")
      .single();
    if (lineErr || !line) throw new Error(`Failed to create test line: ${lineErr?.message}`);

    const { error: costErr } = await (serviceClient as any)
      .from("goods_receipt_line_costs")
      .insert({ line_id: line.id, unit_cost: 15.5 });
    if (costErr) throw new Error(`Failed to create test line cost: ${costErr.message}`);
  });

  afterAll(async () => {
    // Deletion order matters: goods_receipt_line_costs and stock_movement_costs
    // are children of goods_receipt_lines / stock_movements respectively, with
    // no ON DELETE CASCADE (the ledger tables are deliberately append-only/
    // restrict-by-default). Deleting a parent before its children silently
    // fails the FK constraint; errors here were never checked, so every CI run
    // left this test's product, variant, receipt and lines behind as
    // permanent orphans in the test Supabase project.
    if (testReceiptId) {
      const { data: lines } = await (serviceClient as any)
        .from("goods_receipt_lines")
        .select("id")
        .eq("receipt_id", testReceiptId);
      const lineIds = (lines ?? []).map((l: any) => l.id);
      if (lineIds.length > 0) {
        await (serviceClient as any).from("goods_receipt_line_costs").delete().in("line_id", lineIds);
      }
      await (serviceClient as any).from("goods_receipt_lines").delete().eq("receipt_id", testReceiptId);
      await (serviceClient as any).from("goods_receipts").delete().eq("id", testReceiptId);
    }
    if (testVariantId) {
      const { data: movements } = await (serviceClient as any)
        .from("stock_movements")
        .select("id")
        .eq("variant_id", testVariantId);
      const movementIds = (movements ?? []).map((m: any) => m.id);
      if (movementIds.length > 0) {
        await (serviceClient as any).from("stock_movement_costs").delete().in("movement_id", movementIds);
      }
      await (serviceClient as any).from("stock_movements").delete().eq("variant_id", testVariantId);
      await (serviceClient as any).from("variant_costs").delete().eq("variant_id", testVariantId);
      await (serviceClient as any).from("product_variants").delete().eq("id", testVariantId);
    }
    if (testProductId) {
      await (serviceClient as any).from("products").delete().eq("id", testProductId);
    }
    if (testSupplierId) {
      await (serviceClient as any).from("suppliers").delete().eq("id", testSupplierId);
    }
    if (adminSession) {
      await cleanupTestUser(adminSession.userId);
    }
  });

  it("posts receipt through Express route and asserts ledger movements exist without 42501", async () => {
    const apiPort = process.env.PORT || "5000";
    const postRes = await fetch(`http://localhost:${apiPort}/api/admin/receipts/${testReceiptId}/post`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${adminSession!.accessToken}`,
        "Content-Type": "application/json",
      },
    });

    expect(postRes.status).toBe(200);
    const postJson = await postRes.json();
    expect(postJson).toEqual({ success: true });

    // Assert receipt is posted
    const { data: updatedRcpt } = await (serviceClient as any)
      .from("goods_receipts")
      .select("status, transaction_id, posted_by")
      .eq("id", testReceiptId)
      .single();
    expect(updatedRcpt?.status).toBe("posted");
    expect(updatedRcpt?.posted_by).toBe(adminSession!.userId);
    expect(updatedRcpt?.transaction_id).toBeTruthy();

    // Assert immutable ledger movements exist and match
    const { data: movements } = await (serviceClient as any)
      .from("stock_movements")
      .select("variant_id, quantity_delta, reason, reference_type, actor_id, transaction_id")
      .eq("transaction_id", updatedRcpt!.transaction_id);

    expect(movements?.length).toBe(1);
    expect(movements![0].variant_id).toBe(testVariantId);
    expect(Number(movements![0].quantity_delta)).toBe(10);
    expect(movements![0].reason).toBe("goods_receipt");
    expect(movements![0].reference_type).toBe("goods_receipt_line");
    expect(movements![0].actor_id).toBe(adminSession!.userId);
  });

  it("direct service-role RPC call succeeds without auth.uid() dependency", async () => {
    // Calling post_goods_receipt directly through service client verifies no 42501 Forbidden
    // against already posted receipt, raising business ST003 (already posted) instead of 42501.
    const { error } = await (serviceClient as any).rpc("post_goods_receipt", {
      p_receipt_id: testReceiptId,
      p_actor_id: adminSession!.userId,
    });

    expect(error).toBeTruthy();
    // Error must be business logic ST003 (already posted), NOT 42501 Forbidden
    expect(error?.code).toBe("ST003");
  });

  it("direct service-role RPC call rejects missing actor_id with ST007", async () => {
    const { error } = await (serviceClient as any).rpc("post_goods_receipt", {
      p_receipt_id: testReceiptId,
      p_actor_id: null,
    });

    expect(error).toBeTruthy();
    expect(error?.code).toBe("ST007");
  });
});
