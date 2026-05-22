import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// ─── Professional flat SVG icons (kontakt.az style) ───────────────────────
function makeSvg(paths) {
  return `data:image/svg+xml;base64,${Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">${paths}</svg>`).toString("base64")}`;
}

const BG = `<rect width="100" height="100" rx="16" fill="#FFF8E1"/>`;
const COLOR = "#37474F";

const ICONS = {
  smartfonlar: makeSvg(`${BG}
    <rect x="29" y="8" width="42" height="84" rx="8" fill="${COLOR}"/>
    <rect x="35" y="21" width="30" height="52" rx="3" fill="#ECEFF1"/>
    <circle cx="50" cy="85" r="4" fill="#78909C"/>
    <rect x="42" y="13" width="16" height="4" rx="2" fill="#78909C"/>
    <rect x="38" y="28" width="18" height="3" rx="1.5" fill="#CFD8DC"/>
    <rect x="38" y="35" width="24" height="3" rx="1.5" fill="#CFD8DC"/>
    <rect x="38" y="42" width="20" height="3" rx="1.5" fill="#CFD8DC"/>
  `),
  noutbuklar: makeSvg(`${BG}
    <rect x="13" y="24" width="74" height="48" rx="5" fill="${COLOR}"/>
    <rect x="19" y="30" width="62" height="36" rx="3" fill="#ECEFF1"/>
    <rect x="7" y="72" width="86" height="10" rx="5" fill="${COLOR}"/>
    <rect x="38" y="72" width="24" height="5" rx="2" fill="#546E7A"/>
    <rect x="24" y="36" width="46" height="24" rx="2" fill="#B0BEC5"/>
    <rect x="24" y="36" width="46" height="3" rx="1" fill="${COLOR}"/>
  `),
  televizorlar: makeSvg(`${BG}
    <rect x="8" y="18" width="84" height="56" rx="6" fill="${COLOR}"/>
    <rect x="15" y="25" width="70" height="42" rx="3" fill="#ECEFF1"/>
    <rect x="42" y="74" width="16" height="9" rx="3" fill="${COLOR}"/>
    <rect x="28" y="83" width="44" height="6" rx="3" fill="${COLOR}"/>
    <rect x="20" y="30" width="60" height="32" rx="2" fill="#B0BEC5"/>
    <rect x="82" y="26" width="4" height="4" rx="2" fill="#FFD700"/>
  `),
  plansetler: makeSvg(`${BG}
    <rect x="19" y="8" width="62" height="84" rx="8" fill="${COLOR}"/>
    <rect x="25" y="17" width="50" height="66" rx="3" fill="#ECEFF1"/>
    <circle cx="50" cy="88" r="3.5" fill="#78909C"/>
    <circle cx="50" cy="12" r="2.5" fill="#78909C"/>
    <rect x="30" y="24" width="40" height="28" rx="2" fill="#B0BEC5"/>
    <rect x="30" y="57" width="18" height="3" rx="1.5" fill="#CFD8DC"/>
    <rect x="30" y="64" width="28" height="3" rx="1.5" fill="#CFD8DC"/>
  `),
  "agilli-saatlar": makeSvg(`${BG}
    <rect x="40" y="6" width="20" height="18" rx="4" fill="${COLOR}"/>
    <rect x="40" y="76" width="20" height="18" rx="4" fill="${COLOR}"/>
    <rect x="24" y="22" width="52" height="56" rx="14" fill="${COLOR}"/>
    <rect x="30" y="28" width="40" height="44" rx="10" fill="#ECEFF1"/>
    <line x1="50" y1="38" x2="50" y2="50" stroke="${COLOR}" stroke-width="3.5" stroke-linecap="round"/>
    <line x1="50" y1="50" x2="59" y2="57" stroke="${COLOR}" stroke-width="3" stroke-linecap="round"/>
    <circle cx="50" cy="50" r="2" fill="${COLOR}"/>
    <rect x="58" y="30" width="6" height="14" rx="3" fill="#78909C"/>
  `),
  audio: makeSvg(`${BG}
    <path d="M50 20 C28 20 18 35 18 52" fill="none" stroke="${COLOR}" stroke-width="7" stroke-linecap="round"/>
    <path d="M50 20 C72 20 82 35 82 52" fill="none" stroke="${COLOR}" stroke-width="7" stroke-linecap="round"/>
    <rect x="12" y="50" width="14" height="26" rx="7" fill="${COLOR}"/>
    <rect x="74" y="50" width="14" height="26" rx="7" fill="${COLOR}"/>
    <rect x="16" y="56" width="6" height="14" rx="3" fill="#78909C"/>
    <rect x="78" y="56" width="6" height="14" rx="3" fill="#78909C"/>
  `),
  "foto-kamera": makeSvg(`${BG}
    <path d="M12 36 Q12 26 22 26 L32 26 L38 16 L62 16 L68 26 L78 26 Q88 26 88 36 L88 72 Q88 82 78 82 L22 82 Q12 82 12 72 Z" fill="${COLOR}"/>
    <circle cx="50" cy="52" r="18" fill="#78909C"/>
    <circle cx="50" cy="52" r="13" fill="#ECEFF1"/>
    <circle cx="50" cy="52" r="7" fill="#90A4AE"/>
    <circle cx="50" cy="52" r="3" fill="${COLOR}"/>
    <circle cx="76" cy="34" r="5" fill="#ECEFF1"/>
    <circle cx="76" cy="34" r="2.5" fill="${COLOR}"/>
    <rect x="20" y="30" width="12" height="8" rx="3" fill="#546E7A"/>
  `),
  "oyun-avadanligi": makeSvg(`${BG}
    <path d="M14 44 C10 44 8 52 10 62 L18 78 C22 88 36 86 40 76 L44 66 L56 66 L60 76 C64 86 78 88 82 78 L90 62 C92 52 90 44 86 44 Z" fill="${COLOR}"/>
    <rect x="28" y="50" width="4" height="16" rx="2" fill="white"/>
    <rect x="22" y="56" width="16" height="4" rx="2" fill="white"/>
    <circle cx="65" cy="52" r="3.5" fill="white"/>
    <circle cx="73" cy="60" r="3.5" fill="white"/>
    <circle cx="65" cy="68" r="3.5" fill="white"/>
    <circle cx="57" cy="60" r="3.5" fill="white"/>
    <rect x="42" y="44" width="16" height="6" rx="3" fill="#546E7A"/>
  `),
  "ev-texnikasi": makeSvg(`${BG}
    <rect x="14" y="10" width="72" height="80" rx="7" fill="${COLOR}"/>
    <rect x="20" y="16" width="60" height="14" rx="3" fill="#546E7A"/>
    <circle cx="30" cy="23" r="5" fill="#FFD700"/>
    <circle cx="44" cy="23" r="4" fill="#78909C"/>
    <circle cx="54" cy="23" r="4" fill="#78909C"/>
    <circle cx="50" cy="60" r="22" fill="#ECEFF1"/>
    <circle cx="50" cy="60" r="14" fill="#CFD8DC"/>
    <circle cx="50" cy="60" r="5" fill="${COLOR}"/>
    <path d="M50 46 A14 14 0 0 1 64 60" fill="none" stroke="${COLOR}" stroke-width="3" stroke-linecap="round"/>
  `),
  aksesuarlar: makeSvg(`${BG}
    <rect x="36" y="8" width="28" height="34" rx="5" fill="${COLOR}"/>
    <rect x="44" y="8" width="4" height="12" rx="2" fill="#78909C"/>
    <rect x="52" y="8" width="4" height="12" rx="2" fill="#78909C"/>
    <rect x="44" y="42" width="12" height="10" rx="0" fill="${COLOR}"/>
    <rect x="47" y="52" width="6" height="14" rx="3" fill="${COLOR}"/>
    <rect x="34" y="66" width="32" height="22" rx="5" fill="${COLOR}"/>
    <rect x="40" y="72" width="20" height="4" rx="2" fill="white"/>
    <rect x="40" y="79" width="14" height="4" rx="2" fill="#78909C"/>
  `),
};

// ─── Product → Category mapping ──────────────────────────────────────────
const PRODUCT_CATEGORIES = {
  smartfonlar: [
    "apple-iphone-15-pro-max-256gb","apple-iphone-15-128gb","samsung-galaxy-s24-ultra-256gb",
    "samsung-galaxy-s24-128gb","samsung-galaxy-a55-256gb","xiaomi-14-pro-512gb",
    "xiaomi-redmi-note-13-pro-128gb","xiaomi-13t-pro-256gb","huawei-p60-pro-256gb",
    "oppo-reno12-pro-256gb","samsung-galaxy-a35-128gb","xiaomi-redmi-13c-256gb",
    "samsung-galaxy-z-fold5-256gb","vivo-v30-pro-256gb","realme-gt6-256gb",
  ],
  noutbuklar: [
    "apple-macbook-air-m2-256gb","apple-macbook-pro-14-m3-512gb","lenovo-thinkpad-x1-carbon-gen12",
    "dell-xps-15-9530-512gb","hp-pavilion-15-ew2","asus-vivobook-15-oled-2024",
    "acer-aspire-5-a515-2024","lenovo-legion-5-rtx4060-2024","msi-katana-gf66-rtx4060",
    "hp-victus-16-rtx3050-512gb","asus-zenbook-14-oled-2024","samsung-galaxy-book3-ultra-512gb",
    "microsoft-surface-pro-9-i5-256gb","dell-inspiron-15-i7-512gb","lenovo-ideapad-gaming-3-rtx3050",
  ],
  televizorlar: [
    "lg-c3-oled-55-2023","samsung-qn90d-neo-qled-55","sony-a95l-65-qd-oled-4k",
    "lg-b3-oled-65-4k","samsung-q60d-qled-50-4k","xiaomi-tv-a2-65-4k",
    "sony-x90l-55-4k-led","tcl-c745-55-qled-mini-led","hisense-u8k-65-mini-led-4k",
    "samsung-cu7000-43-crystal-uhd","lg-ur8100-75-4k-uhd","xiaomi-tv-a2-32-hd-smart",
    "philips-oled908-65-ambilight","tcl-s5400a-50-4k-android","hisense-a6-50-4k-vidaa",
  ],
  plansetler: [
    "apple-ipad-pro-m4-13-256gb","apple-ipad-air-11-m2-128gb","apple-ipad-10th-gen-64gb",
    "samsung-galaxy-tab-s9-ultra-256gb","samsung-galaxy-tab-s9-128gb","xiaomi-pad-6-pro-256gb",
    "huawei-matepad-pro-13-256gb","lenovo-tab-p12-pro-128gb","samsung-galaxy-tab-a9-plus-128gb",
    "apple-ipad-mini-6-64gb","xiaomi-pad-6-128gb","oppo-pad-2-256gb",
    "samsung-galaxy-tab-s6-lite-2024","huawei-matepad-11-2023-128gb","lenovo-tab-p11-gen2-128gb",
  ],
  "agilli-saatlar": [
    "apple-watch-series-9-41mm","apple-watch-ultra-2-49mm","samsung-galaxy-watch6-44mm",
    "samsung-galaxy-watch-classic-pro-47mm","huawei-watch-gt4-46mm","xiaomi-watch-s3-47mm",
    "garmin-fenix-7-pro-solar","fitbit-versa-4-smartwatch","huawei-watch-4-pro-48mm",
    "oppo-band-3-pro","xiaomi-smart-band-8-pro","samsung-galaxy-watch6-classic-43mm",
    "garmin-vivomove-5-sport","huawei-band-9","apple-watch-se-2-40mm-gps",
  ],
  audio: [
    "sony-wh-1000xm5-noise-cancelling","apple-airpods-pro-2nd-gen","samsung-galaxy-buds2-pro",
    "bose-quietcomfort-45-wireless","jbl-partybox-310-speaker","sony-srs-xb43-extra-bass-speaker",
    "jbl-tune-770nc-wireless","xiaomi-redmi-buds-4-pro","huawei-freebuds-pro-3",
    "bose-smart-soundbar-700","samsung-hw-q990c-soundbar","apple-airpods-3rd-gen-lightning",
    "jbl-charge-5-portable-speaker","samsung-galaxy-buds3-pro","sony-wf-1000xm5-tws",
  ],
  "foto-kamera": [
    "sony-alpha-a7-iv-mirrorless","canon-eos-r6-mark-ii-body","nikon-z-fc-mirrorless-body",
    "fujifilm-x-t5-body","sony-zv-e10-vlog-camera","canon-powershot-g7x-mark-iii",
    "dji-osmo-action-5-pro","gopro-hero12-black","sony-alpha-a6700-body",
    "nikon-z30-vlog-body","insta360-x4-360-camera","fujifilm-x-s20-body",
    "sony-rx100-vii-compact","dji-air-3-drone-fly-more","canon-eos-r50-18-45mm-kit",
  ],
  "oyun-avadanligi": [
    "sony-playstation-5-825gb","microsoft-xbox-series-x-1tb","nintendo-switch-oled-model",
    "sony-dualsense-ps5-controller-white","logitech-g-pro-x-superlight2","razer-basilisk-v3-pro-wired",
    "samsung-odyssey-g9-49-curved-gaming","microsoft-xbox-series-s-512gb","hyperx-cloud-alpha-wireless-gaming",
    "steam-deck-512gb-oled","razer-kishi-v2-mobile-controller","asus-rog-ally-x-512gb",
    "logitech-g29-driving-force-wheel","meta-quest-3-mixed-reality","sennheiser-gsp-600-gaming-headset",
  ],
  "ev-texnikasi": [
    "lg-turbowash-9kg-ai-washing-machine","samsung-bespoke-4-door-flex-refrigerator",
    "dyson-v15-detect-absolute-vacuum","lg-dualcool-12000-btu-ac","philips-air-purifier-ac2958",
    "instant-pot-duo-crisp-6l","samsung-ww90t-ai-ecobubble-9kg","dyson-hp09-hot-cool-purifier",
    "lg-corbot-r5t-robot-vacuum","kitchenaid-artisan-stand-mixer-5qt",
    "philips-3200-series-espresso-machine","irobot-roomba-j9-plus-combo",
    "samsung-mg28-convection-microwave","dyson-airwrap-multi-styler-complete","lg-quadwash-14-place-dishwasher",
  ],
  aksesuarlar: [
    "apple-magsafe-charger-15w","anker-736-100w-gan-charger","ugreen-usb-c-to-c-240w-cable",
    "spigen-screen-protector-iphone-15-pro","baseus-7-in-1-usb-c-hub","ringke-fusion-case-iphone-15-pro-max",
    "anker-powercore-26800-power-bank","samsung-t7-portable-ssd-1tb","belkin-iphone-stand-15w-magsafe",
    "logitech-mx-keys-s-wireless-keyboard","logitech-mx-master-3s-wireless-mouse",
    "samsung-evo-plus-256gb-microsd","3mk-privacy-screen-filter-macbook14",
    "esr-ipad-pro-11-rebound-case","jbl-clip-5-mini-bluetooth-speaker",
  ],
};

// Better Unsplash image URLs for known broken ones
const IMAGE_FIXES = {
  "sony-x90l-55-4k-led": "https://images.unsplash.com/photo-1593359677879-a4bb92f4834c?w=600&q=80",
  "lg-c3-oled-55-2023": "https://images.unsplash.com/photo-1601944179066-29786cb9d32a?w=600&q=80",
  "samsung-qn90d-neo-qled-55": "https://images.unsplash.com/photo-1567690187548-f07b1d7bf754?w=600&q=80",
  "philips-oled908-65-ambilight": "https://images.unsplash.com/photo-1509281373149-e957c6296406?w=600&q=80",
  "sony-playstation-5-825gb": "https://images.unsplash.com/photo-1607853202273-797f1c22a38e?w=600&q=80",
  "microsoft-xbox-series-x-1tb": "https://images.unsplash.com/photo-1605901309584-818e25960a8f?w=600&q=80",
  "nintendo-switch-oled-model": "https://images.unsplash.com/photo-1578303512597-81e6cc155b3e?w=600&q=80",
  "meta-quest-3-mixed-reality": "https://images.unsplash.com/photo-1593508512255-86ab42a8e620?w=600&q=80",
  "dyson-v15-detect-absolute-vacuum": "https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=600&q=80",
  "kitchenaid-artisan-stand-mixer-5qt": "https://images.unsplash.com/photo-1556909114-f6e7ad7d3136?w=600&q=80",
  "dyson-airwrap-multi-styler-complete": "https://images.unsplash.com/photo-1522338242992-e1a54906a8da?w=600&q=80",
};

async function run() {
  console.log("🎨 Step 1: Updating category icons...\n");

  const { data: cats } = await admin.from("categories").select("id, slug");
  for (const cat of cats ?? []) {
    const icon = ICONS[cat.slug];
    if (!icon) continue;
    await admin.from("categories").update({ icon_url: icon }).eq("id", cat.id);
    console.log(`  ✅ ${cat.slug}`);
  }

  console.log("\n🔗 Step 2: Creating category-product links via product_specs...\n");

  // Get all products by slug → id mapping
  const { data: allProds } = await admin.from("products").select("id, slug");
  const slugToId = {};
  for (const p of allProds ?? []) slugToId[p.slug] = p.id;

  // Get all categories by slug → id mapping
  const catSlugToId = {};
  for (const cat of cats ?? []) catSlugToId[cat.slug] = cat.id;

  // Delete existing __category specs to start fresh
  await admin.from("product_specs").delete().eq("spec_key", "__category");
  console.log("  🗑  Cleared old __category specs");

  let linked = 0;
  const specsToInsert = [];
  for (const [catSlug, productSlugs] of Object.entries(PRODUCT_CATEGORIES)) {
    const catId = catSlugToId[catSlug];
    if (!catId) { console.warn(`  ⚠️  Category not found: ${catSlug}`); continue; }
    for (const pSlug of productSlugs) {
      const pId = slugToId[pSlug];
      if (!pId) { console.warn(`  ⚠️  Product not found: ${pSlug}`); continue; }
      specsToInsert.push({ product_id: pId, spec_key: "__category", spec_value: catId, sort_order: 9999 });
      linked++;
    }
  }

  // Insert in batches of 50
  for (let i = 0; i < specsToInsert.length; i += 50) {
    const batch = specsToInsert.slice(i, i + 50);
    const { error } = await admin.from("product_specs").insert(batch);
    if (error) console.error(`  ❌ Batch ${i/50}: ${error.message}`);
  }
  console.log(`  ✅ Linked ${linked} products to categories`);

  console.log("\n🖼  Step 3: Fixing broken product images...\n");
  for (const [slug, newUrl] of Object.entries(IMAGE_FIXES)) {
    const prodId = slugToId[slug];
    if (!prodId) continue;
    const { error } = await admin.from("product_images")
      .update({ url: newUrl })
      .eq("product_id", prodId)
      .eq("sort_order", 0);
    if (!error) console.log(`  ✅ ${slug}`);
  }

  console.log("\n✨ Done!");
}

run().catch(e => { console.error(e); process.exit(1); });
