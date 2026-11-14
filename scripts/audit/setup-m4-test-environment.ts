import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import path from "path";

// Load environment variables from artifacts/api-server/.env
dotenv.config({ path: path.resolve(process.cwd(), "artifacts/api-server/.env") });
dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceRoleKey) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variable");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function setup() {
  console.log("=== M4 Stock Signals Test Environment Provisioning ===");
  console.log("Target Database:", supabaseUrl);

  // 1. Ensure Test Users & Roles
  console.log("\n1. Provisioning Test Users & Roles...");
  const testUsers = [
    { phone: "+994550000001", role: "admin", email: "admin@test.internal" },
    { phone: "+994550000002", role: "staff", email: "staff@test.internal" },
    { phone: "+994550000003", role: "customer", email: "shopper@test.internal" },
  ];

  for (const tu of testUsers) {
    const authPhone = tu.phone.replace(/^\+/, "");
    const { data: listData } = await supabase.auth.admin.listUsers({ perPage: 1000 });
    let authUser = listData?.users?.find((u) => u.phone === authPhone || u.phone === tu.phone);

    if (!authUser) {
      const { data: created, error: createErr } = await supabase.auth.admin.createUser({
        phone: tu.phone,
        email: tu.email,
        phone_confirm: true,
        email_confirm: true,
      });
      if (!createErr && created?.user) authUser = created.user;
    }

    if (authUser) {
      await supabase.from("users").upsert(
        { id: authUser.id, phone: tu.phone, role: tu.role },
        { onConflict: "id" }
      );
      console.log(`  User ${tu.phone}: id=${authUser.id}, role=${tu.role} OK`);
    }
  }

  // 2. Configure Store Settings
  console.log("\n2. Configuring Store Settings...");
  const settings = [
    { key: "low_stock_threshold", value: "10" },
    { key: "dead_stock_days", value: "90" },
    { key: "reorder_target_days", value: "60" },
    { key: "reorder_velocity_window_days", value: "28" },
    { key: "reorder_min_sales", value: "3" },
  ];
  for (const s of settings) {
    await supabase.from("store_settings").upsert(
      { key: s.key, value: s.value, updated_at: new Date().toISOString() },
      { onConflict: "key" }
    );
  }
  console.log("  Store settings ready.");

  // 3. Supplier Baku Electronics MMC
  console.log("\n3. Provisioning Supplier...");
  let { data: supplier } = await supabase
    .from("suppliers")
    .select("id")
    .eq("name", "Baku Electronics MMC")
    .maybeSingle();

  if (!supplier) {
    const { data: createdSup, error: supErr } = await supabase
      .from("suppliers")
      .insert({
        name: "Baku Electronics MMC",
        contact_info: "+994124000000, info@bakuelectronics.az",
        notes: "M4 QA Test Təchizatçısı",
        is_active: true,
      })
      .select("id")
      .single();
    if (supErr) throw supErr;
    supplier = createdSup;
  }
  console.log("  Supplier ready:", supplier.id);

  // 4. QA Category
  console.log("\n4. Provisioning QA Category...");
  let { data: cat } = await supabase
    .from("categories")
    .select("id")
    .eq("slug", "qa-m4-test-category")
    .maybeSingle();

  if (!cat) {
    const { data: createdCat, error: catErr } = await supabase
      .from("categories")
      .insert({ slug: "qa-m4-test-category" })
      .select("id")
      .single();
    if (catErr) throw catErr;
    cat = createdCat;

    await supabase.from("category_translations").upsert([
      { category_id: cat.id, lang_code: "az", title: "QA M4 Test Kateqoriyası" },
      { category_id: cat.id, lang_code: "en", title: "QA M4 Test Category" },
      { category_id: cat.id, lang_code: "ru", title: "QA M4 Тестовая Категория" },
    ]);
  }
  console.log("  Category ready:", cat.id);

  // 5. Find or Create Products and Variants
  console.log("\n5. Ensuring QA-M4 Products and Variants...");
  const daysAgo = (d: number) => new Date(Date.now() - d * 24 * 60 * 60 * 1000).toISOString();

  async function ensureProduct(titleAz: string, titleEn: string, titleRu: string, slug: string) {
    let { data: prod } = await supabase.from("products").select("id").eq("slug", slug).maybeSingle();
    if (!prod) {
      const { data: created, error } = await supabase
        .from("products")
        .insert({ slug, price: 19.99, stock: 0, sku: slug })
        .select("id")
        .single();
      if (error) throw error;
      prod = created;

      await supabase.from("product_categories").upsert({ product_id: prod.id, category_id: cat.id });
      await supabase.from("product_translations").upsert([
        { product_id: prod.id, lang_code: "az", title: titleAz, description: `${titleAz} - QA Test` },
        { product_id: prod.id, lang_code: "en", title: titleEn, description: `${titleEn} - QA Test` },
        { product_id: prod.id, lang_code: "ru", title: titleRu, description: `${titleRu} - QA Test` },
      ]);
    }
    return prod.id;
  }

  async function ensureVariant(params: {
    productId: string;
    sku: string;
    price: number;
    targetOnHand: number;
    threshold: number | null;
    trackStock?: boolean;
    costPrice?: number;
    barcode?: string;
  }) {
    let { data: v } = await supabase.from("product_variants").select("id, on_hand").eq("sku", params.sku).maybeSingle();
    if (!v) {
      const { data: created, error } = await supabase
        .from("product_variants")
        .insert({
          product_id: params.productId,
          sku: params.sku,
          price: params.price,
          on_hand: 0,
          low_stock_threshold: params.threshold,
          track_stock: params.trackStock ?? true,
          unit_of_measure: "pcs",
        })
        .select("id, on_hand")
        .single();
      if (error) throw error;
      v = created;
    } else {
      await supabase
        .from("product_variants")
        .update({
          low_stock_threshold: params.threshold,
          track_stock: params.trackStock ?? true,
          price: params.price,
        })
        .eq("id", v.id);
    }

    if (params.costPrice !== undefined) {
      await supabase.from("variant_costs").upsert(
        {
          variant_id: v.id,
          cost_price: params.costPrice,
          opening_cost: params.costPrice,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "variant_id" }
      );
    }

    if (params.barcode) {
      const { data: bc } = await supabase.from("variant_barcodes").select("id").eq("variant_id", v.id).maybeSingle();
      if (!bc) {
        await supabase.from("variant_barcodes").insert({ variant_id: v.id, barcode: params.barcode });
      }
    }

    // Check if initial movements are needed to reach targetOnHand
    if (params.trackStock !== false) {
      const currentOnHand = Number(v.on_hand || 0);
      const diff = params.targetOnHand - currentOnHand;
      if (diff !== 0) {
        await supabase.from("stock_movements").insert({
          variant_id: v.id,
          quantity_delta: diff,
          reason: "goods_receipt",
          reference_type: "goods_receipt_line",
          posting_date: daysAgo(60),
          created_at: daysAgo(60),
        });
      }
    }

    return v.id;
  }

  const p1Id = await ensureProduct("QA Qulaqlıqlar (Ehtiyat Siqnalları)", "QA Headphones", "QA Наушники", "qa-m4-headphones");
  const vLow01 = await ensureVariant({ productId: p1Id, sku: "QA-M4-LOW-01", price: 49.99, targetOnHand: 12, threshold: 10, costPrice: 25.0, barcode: "994000000001" });
  const vOut02 = await ensureVariant({ productId: p1Id, sku: "QA-M4-OUT-02", price: 79.99, targetOnHand: 4, threshold: 5, costPrice: 40.0, barcode: "994000000002" });
  const vGlobal03 = await ensureVariant({ productId: p1Id, sku: "QA-M4-GLOBAL-03", price: 29.99, targetOnHand: 8, threshold: null, costPrice: 15.0, barcode: "994000000003" });
  const vHealthy04 = await ensureVariant({ productId: p1Id, sku: "QA-M4-HEALTHY-04", price: 39.99, targetOnHand: 25, threshold: 5, costPrice: 18.0, barcode: "994000000004" });

  const p2Id = await ensureProduct("QA Qol Saatları (Satılmayan Mallar)", "QA Watches", "QA Часы", "qa-m4-watches");
  const vDead30 = await ensureVariant({ productId: p2Id, sku: "QA-M4-DEAD-30", price: 120.0, targetOnHand: 15, threshold: 5, costPrice: 20.0, barcode: "994000000005" });
  const vDead90 = await ensureVariant({ productId: p2Id, sku: "QA-M4-DEAD-90", price: 150.0, targetOnHand: 10, threshold: 5, costPrice: 25.0, barcode: "994000000006" });
  const vDead180 = await ensureVariant({ productId: p2Id, sku: "QA-M4-DEAD-180", price: 80.0, targetOnHand: 40, threshold: 5, costPrice: 10.0, barcode: "994000000007" });
  const vActive = await ensureVariant({ productId: p2Id, sku: "QA-M4-ACTIVE-ITEM", price: 95.0, targetOnHand: 15, threshold: 5, costPrice: 20.0, barcode: "994000000008" });

  const p3Id = await ensureProduct("QA Aksessuarlar (Sifariş Sürəti)", "QA Accessories", "QA Аксессуары", "qa-m4-accessories");
  const vReorderFast = await ensureVariant({ productId: p3Id, sku: "QA-M4-REORDER-FAST", price: 15.0, targetOnHand: 6, threshold: 10, costPrice: 8.0, barcode: "994000000009" });
  const vReorderLow = await ensureVariant({ productId: p3Id, sku: "QA-M4-REORDER-INSUFFICIENT", price: 18.0, targetOnHand: 5, threshold: 10, costPrice: 9.0, barcode: "994000000010" });
  const vReorderZero = await ensureVariant({ productId: p3Id, sku: "QA-M4-REORDER-ZERO", price: 22.0, targetOnHand: 8, threshold: 5, costPrice: 11.0, barcode: "994000000011" });

  const p4Id = await ensureProduct("QA Xidmətlər və Dəstlər", "QA Services and Bundles", "QA Услуги и Комплекты", "qa-m4-services");
  const vService = await ensureVariant({ productId: p4Id, sku: "QA-M4-SERVICE-NOTRACK", price: 5.0, targetOnHand: 0, threshold: null, trackStock: false, barcode: "994000000012" });

  // 6. Ensure Supplier association via Goods Receipt
  console.log("\n6. Ensuring Goods Receipt for Supplier Association...");
  const { data: existingGr } = await supabase.from("goods_receipts").select("id").eq("receipt_number", "GR-QA-M4-001").maybeSingle();
  let grId = existingGr?.id;
  if (!grId) {
    const { data: newGr } = await supabase.from("goods_receipts").insert({
      receipt_number: "GR-QA-M4-001",
      supplier_id: supplier.id,
      status: "posted",
      posting_date: daysAgo(60),
    }).select("id").single();
    grId = newGr?.id;
  }
  if (grId) {
    const { data: grLine } = await supabase.from("goods_receipt_lines").select("id").eq("receipt_id", grId).eq("variant_id", vReorderFast).maybeSingle();
    if (!grLine) {
      await supabase.from("goods_receipt_lines").insert({
        receipt_id: grId,
        variant_id: vReorderFast,
        quantity: 62,
      });
    }
  }

  // 7. Ensure Reservations
  console.log("\n7. Ensuring Active Reservations...");
  const { data: adminUser } = await supabase.from("users").select("id").eq("role", "admin").limit(1).single();

  // Clean existing reservations for test variants to be idempotent
  await supabase.from("reservations").delete().in("variant_id", [vLow01, vOut02]);

  // vLow01: 5 reserved -> available = 12 - 5 = 7 (threshold = 10 -> Low)
  await supabase.from("reservations").insert({
    reservation_number: `RES-QA-M4-01-${Date.now()}`,
    variant_id: vLow01,
    quantity: 5,
    customer_name: "QA Test Customer 1",
    customer_phone: "+994550000000",
    hold_type: "deposit",
    status: "active",
    agreed_price: 49.99,
    paid_amount: 10.0,
    created_by: adminUser?.id,
    expires_at: daysAgo(-7), // 7 days in future
    notes: "QA M4 Test Reservation 1",
  });

  // vOut02: 4 reserved -> available = 4 - 4 = 0 (threshold = 5 -> Out of Stock)
  await supabase.from("reservations").insert({
    reservation_number: `RES-QA-M4-02-${Date.now()}`,
    variant_id: vOut02,
    quantity: 4,
    customer_name: "QA Test Customer 2",
    customer_phone: "+994550000000",
    hold_type: "deposit",
    status: "active",
    agreed_price: 79.99,
    paid_amount: 20.0,
    created_by: adminUser?.id,
    expires_at: daysAgo(-7), // 7 days in future
    notes: "QA M4 Test Reservation 2",
  });
  console.log("  Active reservations ready.");

  // 8. Ensure Bundle
  console.log("\n8. Ensuring Hybrid Bundle...");
  await supabase.from("bundles").delete().eq("name", "QA Hibrid Dəst (Bundle)");
  const { data: createdBundle, error: bErr } = await supabase.from("bundles").insert({
    name: "QA Hibrid Dəst (Bundle)",
    bundle_price: 52.0,
    is_active: true,
    created_by: adminUser?.id,
  }).select("id").single();
  if (bErr) throw bErr;
  const bundle = createdBundle;
  if (bundle) {
    await supabase.from("bundle_lines").insert([
      { bundle_id: bundle.id, variant_id: vLow01, quantity: 1 },
      { bundle_id: bundle.id, variant_id: vService, quantity: 1 },
    ]);
  }
  console.log("  Bundle ready:", bundle.id);

  console.log("\n=== M4 Test Environment Provisioning Successfully Completed! ===");
}

setup().catch((err) => {
  console.error("Setup failed:", err);
  process.exit(1);
});
