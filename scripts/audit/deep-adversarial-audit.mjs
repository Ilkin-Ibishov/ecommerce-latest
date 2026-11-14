import { chromium } from '../../artifacts/store/node_modules/@playwright/test/index.mjs';
import fs from 'fs';
import path from 'path';

const SCREENSHOT_DIR = path.resolve('docs/audits/wave-business-audit/screenshots-v3');
if (!fs.existsSync(SCREENSHOT_DIR)) {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
}

const findings = [];
const consoleErrors = [];
const networkErrors = [];

async function logInAsAdmin(page) {
  await page.goto('http://localhost:3000/admin/counter', { waitUntil: 'networkidle' });
  const signInBtn = page.getByRole('button', { name: /Sign In with Phone/i });
  if (await signInBtn.isVisible()) {
    await signInBtn.click();
    await page.waitForTimeout(500);
    await page.locator('input[type="tel"]').fill('550000001');
    await page.locator('button[type="submit"]').click();
    await page.waitForTimeout(800);
    const otpInput = page.locator('input[placeholder*="kod"], input[placeholder*="code"], input[type="text"]').last();
    await otpInput.fill('999999');
    await page.locator('button[type="submit"]').click();
    await page.waitForTimeout(3000);
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);
  }
}

async function runDeepAudit() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  page.on('console', msg => {
    if (msg.type() === 'error') {
      consoleErrors.push({ text: msg.text(), url: page.url() });
    }
  });

  page.on('response', resp => {
    if (resp.status() >= 400 && !resp.url().includes('favicon')) {
      networkErrors.push({
        url: resp.url(),
        status: resp.status(),
        page: page.url()
      });
    }
  });

  console.log('=== TEST SUITE 1: FINANCIAL & CHECKOUT ADVERSARIAL TESTS ===');

  // 1.1 Empty Cart direct checkout navigation
  console.log('1.1 Testing Empty Cart direct navigation to /az/checkout...');
  await page.goto('http://localhost:3000/az/checkout', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);
  const emptyCheckoutText = await page.innerText('body');
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, '01-empty-cart-checkout.png') });
  if (!emptyCheckoutText.includes('boşdur') && !emptyCheckoutText.includes('empty') && !page.url().includes('/cart')) {
    findings.push({
      id: 'BUG-CHECKOUT-01',
      severity: 'P1 (Biznes Məntiqi)',
      title: 'Boş Səbətlə Checkout Səhifəsinin Açıq Qalması',
      details: 'Səbət tamamilə boş olduğu halda /az/checkout səhifəsi istifadəçiyə çatdırılma formasını açır və sifariş tərtib etməyə imkan verir (və ya səbətə yönləndirmir).',
      evidence: '01-empty-cart-checkout.png'
    });
  }

  // 1.2 Invalid and Expired Coupon Test in Cart / Checkout
  console.log('1.2 Testing Invalid Coupon injection...');
  await page.goto('http://localhost:3000/az/products', { waitUntil: 'networkidle' });
  const addBtn = page.locator('button').filter({ hasText: /Səbətə at|Add to cart/i }).first();
  if (await addBtn.isVisible()) {
    await addBtn.click();
    await page.waitForTimeout(1000);

    // Look for coupon input in CartDrawer or Checkout
    const couponInput = page.locator('input[placeholder*="Kupon"], input[placeholder*="Promo"]');
    if (await couponInput.isVisible()) {
      await couponInput.fill('EXPIRED_OR_FAKE_CODE_999');
      const applyBtn = page.locator('button').filter({ hasText: /Tətbiq et|Apply/i }).first();
      if (await applyBtn.isVisible()) {
        await applyBtn.click();
        await page.waitForTimeout(800);
        await page.screenshot({ path: path.join(SCREENSHOT_DIR, '02-coupon-fake-applied.png') });
      }
    }
  }

  // 1.3 Rapid Double-Click / Race Condition on Checkout Submit
  console.log('1.3 Testing Rapid Double Click on Checkout...');
  await page.goto('http://localhost:3000/az/checkout', { waitUntil: 'networkidle' });
  const nameInput = page.locator('input[name="fullName"], input[type="text"]').first();
  const phoneInput = page.locator('input[name="phone"], input[type="tel"]').first();
  const addressInput = page.locator('input[name="address"], textarea[name="address"]').first();

  if (await nameInput.isVisible() && await phoneInput.isVisible() && await addressInput.isVisible()) {
    await nameInput.fill('Test Alıcı ' + Date.now());
    await phoneInput.fill('501234567');
    await addressInput.fill('Bakı ş., Nizami küç. 10');
    await page.waitForTimeout(500);

    const submitOrderBtn = page.locator('button[type="submit"]').filter({ hasText: /Sifarişi təsdiqlə|Tamamla|Sifariş ver/i }).first();
    if (await submitOrderBtn.isVisible()) {
      // Check if button disables immediately or allows multi-click
      const disabledBefore = await submitOrderBtn.isDisabled();
      await page.screenshot({ path: path.join(SCREENSHOT_DIR, '03-checkout-ready-to-submit.png') });
    }
  }

  // 1.4 Non-existent Order Tracking ID
  console.log('1.4 Testing Non-Existent Order Tracking...');
  await page.goto('http://localhost:3000/az/order-tracking', { waitUntil: 'networkidle' });
  const trackInput = page.locator('input[placeholder*="sifariş"], input[type="text"]').first();
  if (await trackInput.isVisible()) {
    await trackInput.fill('NON-EXISTENT-ORDER-UUID-999');
    await page.locator('button').filter({ hasText: /İzlə|Axtar|Track/i }).first().click();
    await page.waitForTimeout(1000);
    const trackBody = await page.innerText('body');
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, '04-order-tracking-fake.png') });
    if (trackBody.includes('500') || trackBody.includes('Internal Server Error')) {
      findings.push({
        id: 'BUG-TRACK-01',
        severity: 'P1 (Crash)',
        title: 'Mövcud Olmayan Sifariş İzləməsində 500 Xətası',
        details: 'Yanlış və ya mövcud olmayan sifariş nömrəsi yazıldıqda təmiz "Sifariş tapılmadı" mesajı əvəzinə server xətası baş verir.',
        evidence: '04-order-tracking-fake.png'
      });
    }
  }

  console.log('=== TEST SUITE 2: KASSA (POS TERMINAL) ADVERSARIAL STRESS TESTS ===');
  await logInAsAdmin(page);
  await page.goto('http://localhost:3000/admin/counter', { waitUntil: 'networkidle' });

  // 2.1 Add item to POS cart
  const barcodeInput = page.locator('input[placeholder*="Barkodu oxudun"]');
  await barcodeInput.fill('M2C-SALES-1794379416051');
  await barcodeInput.press('Enter');
  await page.waitForTimeout(800);

  // 2.2 Direct Quantity Input with Negative Number & Zero
  console.log('2.2 Testing Negative and Zero Quantity via Direct Input...');
  const qtyBtn = page.locator('button[title*="Dəyişmək üçün klikləyin"]').first();
  if (await qtyBtn.isVisible()) {
    await qtyBtn.click();
    await page.waitForTimeout(300);
    const numInput = page.locator('input[type="number"]');
    if (await numInput.isVisible()) {
      await numInput.fill('-5');
      await numInput.press('Enter');
      await page.waitForTimeout(500);
      const afterNegative = await page.innerText('body');
      await page.screenshot({ path: path.join(SCREENSHOT_DIR, '05-pos-negative-qty.png') });
      if (afterNegative.includes('-5') || afterNegative.includes('-50.00')) {
        findings.push({
          id: 'BUG-POS-01',
          severity: 'P0 (Kritik Maliyyə Sızması)',
          title: 'Kassada Mənfi Say Daxil Edilərək Mənfi Borc Yaradılması',
          details: 'Səbətdə say xanasına birbaşa "-5" yazıldıqda səbət mənfiyə düşür və kassadan pul çıxarılmasına zəmin yaradır.',
          evidence: '05-pos-negative-qty.png'
        });
      }

      // Try zero quantity
      await qtyBtn.click().catch(() => {});
      const numInput2 = page.locator('input[type="number"]');
      if (await numInput2.isVisible()) {
        await numInput2.fill('0');
        await numInput2.press('Enter');
        await page.waitForTimeout(500);
        await page.screenshot({ path: path.join(SCREENSHOT_DIR, '06-pos-zero-qty.png') });
      }
    }
  }

  // 2.3 Reset cart with 1 valid item
  await page.goto('http://localhost:3000/admin/counter', { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);
  await barcodeInput.fill('M2C-SALES-1794379416051');
  await barcodeInput.press('Enter');
  await page.waitForTimeout(800);

  // 2.4 Under-Tender Cash Payment Attempt
  console.log('2.4 Testing Under-tender Cash payment (e.g. Total 10 AZN, Tendered 3 AZN)...');
  const cashBtn = page.getByRole('button', { name: /Nağd/i }).first();
  if (await cashBtn.isVisible()) {
    await cashBtn.click();
    await page.waitForTimeout(300);
    const tenderInput = page.locator('input[placeholder*="Təqdim edilən məbləğ"]').first();
    if (await tenderInput.isVisible()) {
      await tenderInput.fill('2'); // Under total
      await page.waitForTimeout(300);
      const completeBtn = page.getByRole('button', { name: /Tamamla/i });
      const isDisabled = await completeBtn.isDisabled();
      await page.screenshot({ path: path.join(SCREENSHOT_DIR, '07-pos-under-tender.png') });
      if (!isDisabled) {
        // Click complete and see if modal allows confirming
        await completeBtn.click();
        await page.waitForTimeout(500);
        const confirmBtn = page.locator('button').filter({ hasText: /Ödənişi təsdiqlə/i }).last();
        const confirmDisabled = await confirmBtn.isDisabled();
        if (!confirmDisabled) {
          findings.push({
            id: 'BUG-POS-02',
            severity: 'P0 (Kritik Kassa Kəsiri)',
            title: 'Kassada Əksik Pul Verildikdə Satışın Təsdiqlənməsi',
            details: 'Müştəri borcdan az pul təqdim etdikdə (məs: 10 AZN borca 2 AZN nağd) "Tamamla" və təsdiq düyməsi aktiv qalır və qalıq mənfi hesablanır.',
            evidence: '07-pos-under-tender.png'
          });
        }
      }
    }
  }

  // 2.5 Scanning / Looking up Zero Stock Variant
  console.log('2.5 Testing lookup of out-of-stock product in POS...');
  await page.goto('http://localhost:3000/admin/counter', { waitUntil: 'networkidle' });
  await barcodeInput.fill('FIX-1794384083885-82azf3'); // on_hand: 0
  await barcodeInput.press('Enter');
  await page.waitForTimeout(800);
  const zeroStockBody = await page.innerText('body');
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, '08-pos-zero-stock-item.png') });
  if (zeroStockBody.includes('FIX-1794384083885-82azf3') && !zeroStockBody.includes('Səbət boşdur')) {
    findings.push({
      id: 'BUG-POS-03',
      severity: 'P1 (İnventar Uyğunsuzluğu)',
      title: 'Stokda Qalmayan (0 ədəd) Məhsulun Kassada Satışa Əlavə Olunması',
      details: 'Faktiki qalığı 0 olan məhsul kassir tərəfindən barkodla axtarıldıqda xəbərdarlıqsız səbətə salınır və stoku mənfiyə düşürə bilər.',
      evidence: '08-pos-zero-stock-item.png'
    });
  }

  console.log('=== TEST SUITE 3: ANBAR (WAREHOUSE) & RECEIPTS DEEP BUGS ===');
  // 3.1 Receipts Modal - submitting with negative quantity or unit cost
  console.log('3.1 Testing Receipts Modal line validation...');
  await page.goto('http://localhost:3000/admin/receipts', { waitUntil: 'networkidle' });
  const newReceiptBtn = page.getByRole('button', { name: /Yeni qəbz/i });
  if (await newReceiptBtn.isVisible()) {
    await newReceiptBtn.click();
    await page.waitForTimeout(500);

    const addLineBtn = page.locator('button').filter({ hasText: /Sətir əlavə et/i }).first();
    if (await addLineBtn.isVisible()) {
      await addLineBtn.click();
      await page.waitForTimeout(300);

      // Try typing negative quantity or cost in line
      const qtyLineInput = page.locator('input[type="number"]').first();
      if (await qtyLineInput.isVisible()) {
        await qtyLineInput.fill('-10');
        await page.screenshot({ path: path.join(SCREENSHOT_DIR, '09-receipt-negative-qty.png') });
      }
    }
    const closeBtn = page.locator('button').filter({ hasText: /İmtina|Ləğv|✕/i }).last();
    if (await closeBtn.isVisible()) await closeBtn.click();
  }

  // 3.2 Non-existent Receipt Detail Page
  console.log('3.2 Testing non-existent receipt detail page navigation...');
  await page.goto('http://localhost:3000/admin/receipts/00000000-0000-0000-0000-000000000000', { waitUntil: 'networkidle' });
  const receiptDetailBody = await page.innerText('body');
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, '10-receipt-nonexistent-detail.png') });
  if (receiptDetailBody.includes('500') || receiptDetailBody.includes('TypeError')) {
    findings.push({
      id: 'BUG-RECEIPT-01',
      severity: 'P2 (Xəta İdarəetməsi)',
      title: 'Mövcud Olmayan Qəbz Səhifəsində Xam Server Xətası',
      details: 'Tapılmayan qəbz ID-si daxil edildikdə təmiz "Qəbz tapılmadı" ekranı əvəzinə xam xəta çıxır.',
      evidence: '10-receipt-nonexistent-detail.png'
    });
  }

  // 3.3 CSV Export verification
  console.log('3.3 Testing Inventory CSV Export download...');
  await page.goto('http://localhost:3000/admin/inventory', { waitUntil: 'networkidle' });
  const downloadPromise = page.waitForEvent('download', { timeout: 4000 }).catch(() => null);
  const csvBtn = page.locator('button').filter({ hasText: /CSV/i }).first();
  if (await csvBtn.isVisible()) {
    await csvBtn.click();
    const download = await downloadPromise;
    if (download) {
      const downloadPath = path.join(SCREENSHOT_DIR, 'inventory-export.csv');
      await download.saveAs(downloadPath);
      const csvContent = fs.readFileSync(downloadPath, 'utf8');
      const hasBOM = csvContent.charCodeAt(0) === 0xFEFF;
      if (!hasBOM) {
        findings.push({
          id: 'BUG-CSV-01',
          severity: 'P2 (Lokalizasiya & Məlumat)',
          title: 'CSV İxracında UTF-8 BOM Çatışmazlığı (Excel-də Azərbaycan Hərflərinin Pozulması)',
          details: 'İxrac edilən CSV faylı UTF-8 BOM olmadan yazıldığı üçün Microsoft Excel proqramında açıldıqda ə, ı, ğ, ç, ş, ö hərfləri qarışıq simvollara çevrilir.',
          evidence: 'inventory-export.csv'
        });
      }
    }
  }

  console.log('=== TEST SUITE 4: RESPONSIVENESS (EXTREME NARROW 320PX VIEWPORT) ===');
  const narrowContext = await browser.newContext({
    viewport: { width: 320, height: 568 },
    isMobile: true
  });
  const narrowPage = await narrowContext.newPage();
  await narrowPage.goto('http://localhost:3000/az', { waitUntil: 'networkidle' });
  const scrollWidth320 = await narrowPage.evaluate(() => document.documentElement.scrollWidth);
  const clientWidth320 = await narrowPage.evaluate(() => document.documentElement.clientWidth);
  await narrowPage.screenshot({ path: path.join(SCREENSHOT_DIR, '11-narrow-320px-home.png') });
  if (scrollWidth320 > clientWidth320) {
    findings.push({
      id: 'BUG-RESPONSIVE-01',
      severity: 'P2 (UX/UI Mobil Sürüşmə)',
      title: 'Ultra-kiçik Ekranlarda (320px - iPhone SE) Üfüqi Sürüşmə',
      details: `320px enində cihazlarda scrollWidth (${scrollWidth320}px) clientWidth-dən böyükdür və üfüqi sürüşmə qeydə alınır.`,
      evidence: '11-narrow-320px-home.png'
    });
  }

  console.log('=== TEST SUITE 5: SECURITY & PERMISSION BOUNDARIES ===');
  // Test direct unauthenticated access to admin endpoints
  const anonEndpoints = [
    '/api/admin/receipts',
    '/api/admin/users',
    '/api/admin/counter/sales',
    '/api/admin/reports/margins'
  ];

  for (const ep of anonEndpoints) {
    try {
      const res = await fetch(`http://localhost:3000${ep}`);
      if (res.status === 200) {
        findings.push({
          id: 'BUG-SEC-01',
          severity: 'P0 (Təhlükəsizlik Boşluğu)',
          title: `İcazəsiz ${ep} Girişi (200 OK)`,
          details: `Anonim istifadəçi heç bir token təqdim etmədən ${ep} ünvanından məlumat çəkə bilir.`,
          evidence: `Status: ${res.status}`
        });
      }
    } catch { /* ignore */ }
  }

  await browser.close();

  const report = {
    timestamp: new Date().toISOString(),
    totalFindings: findings.length,
    findings,
    consoleErrorsSample: consoleErrors.slice(0, 10),
    networkErrorsSample: networkErrors.slice(0, 10)
  };

  fs.writeFileSync(
    path.join(SCREENSHOT_DIR, 'deep-audit-findings.json'),
    JSON.stringify(report, null, 2)
  );

  console.log('=== DEEP AUDIT COMPLETE ===');
  console.log(JSON.stringify(report, null, 2));
}

runDeepAudit().catch(console.error);
