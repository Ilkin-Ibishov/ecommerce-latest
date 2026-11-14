import { chromium } from '../../artifacts/store/node_modules/@playwright/test/index.mjs';
import fs from 'fs';
import path from 'path';

const SCREENSHOT_DIR = path.resolve('docs/audits/wave-business-audit/screenshots-v2');
if (!fs.existsSync(SCREENSHOT_DIR)) {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
}

const auditLog = {
  timestamp: new Date().toISOString(),
  personas: {},
  networkErrors: [],
  consoleErrors: []
};

async function logInAsAdmin(page) {
  await page.goto('http://localhost:3000/admin/counter', { waitUntil: 'networkidle' });
  const signInBtn = page.getByRole('button', { name: /Sign In with Phone/i });
  if (await signInBtn.isVisible()) {
    await signInBtn.click();
    await page.waitForTimeout(500);
    const phoneInput = page.locator('input[type="tel"]');
    await phoneInput.fill('550000001');
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

async function runAudit() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 }
  });

  const page = await context.newPage();

  page.on('console', msg => {
    if (msg.type() === 'error') {
      auditLog.consoleErrors.push(msg.text());
    }
  });

  page.on('response', resp => {
    if (resp.status() >= 400 && !resp.url().includes('favicon')) {
      auditLog.networkErrors.push({
        url: resp.url(),
        status: resp.status()
      });
    }
  });

  console.log('--- 1. PERSONA: KASSIR (CASHIER / POS) ---');
  await logInAsAdmin(page);
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, '01-pos-initial.png') });

  // Lookup product by SKU and press Enter
  const searchInput = page.locator('input[placeholder*="Barkodu oxudun"], input[placeholder*="axtar"]');
  if (await searchInput.isVisible()) {
    await searchInput.fill('M2C-SALES-1794379416051');
    await searchInput.press('Enter');
    await page.waitForTimeout(1000);
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, '01-pos-search-result.png') });
  }

  // Check CartLines for quantity cell
  const qtyCell = page.locator('button[title*="Dəyişmək üçün klikləyin"]').first();
  let directQtySupported = false;
  if (await qtyCell.isVisible()) {
    await qtyCell.click();
    await page.waitForTimeout(300);
    const qtyInput = page.locator('input[type="number"]');
    if (await qtyInput.isVisible()) {
      await qtyInput.fill('3');
      await qtyInput.press('Enter');
      await page.waitForTimeout(400);
      directQtySupported = true;
    }
  }
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, '01-pos-cart-qty.png') });

  // Test cash tender & change calculation
  const cashBtn = page.getByRole('button', { name: /Nağd/i }).first();
  let changeCalcVerified = false;
  if (await cashBtn.isVisible()) {
    await cashBtn.click();
    await page.waitForTimeout(300);
    const tenderedInput = page.locator('input[placeholder*="Təqdim edilən məbləğ"]').first();
    if (await tenderedInput.isVisible()) {
      await tenderedInput.fill('50');
      await page.waitForTimeout(300);
      const changeText = await page.innerText('body');
      changeCalcVerified = changeText.includes('Qalıq:') && changeText.includes('AZN');
    }
  }
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, '01-pos-cash-change.png') });

  // Test Payment Confirmation Modal
  const completeBtn = page.getByRole('button', { name: /Tamamla/i });
  let confirmationModalVerified = false;
  let receiptModalVerified = false;
  if (await completeBtn.isVisible() && !await completeBtn.isDisabled()) {
    await completeBtn.click();
    await page.waitForTimeout(600);
    const modalText = await page.innerText('body');
    confirmationModalVerified = modalText.includes('Ödənişi təsdiqlə') || modalText.includes('Təsdiq');
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, '01-pos-confirmation-modal.png') });

    // Confirm in modal
    const confirmModalBtn = page.locator('button').filter({ hasText: /Ödənişi təsdiqlə|Təsdiqlə/i }).last();
    if (await confirmModalBtn.isVisible()) {
      await confirmModalBtn.click();
      await page.waitForTimeout(2000);
      const postSaleText = await page.innerText('body');
      receiptModalVerified = postSaleText.includes('Qəbz') && (postSaleText.includes('Çap et') || postSaleText.includes('Yeni Satış'));
      await page.screenshot({ path: path.join(SCREENSHOT_DIR, '01-pos-receipt-modal.png') });

      // Click "Yeni Satış" to close modal and reset
      const newSaleBtn = page.locator('button').filter({ hasText: /Yeni Satış/i }).first();
      if (await newSaleBtn.isVisible()) {
        await newSaleBtn.click();
        await page.waitForTimeout(500);
      }
    }
  }

  // Check sales history headers
  await page.goto('http://localhost:3000/admin/counter/sales', { waitUntil: 'networkidle' });
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, '01-pos-sales-history.png') });

  auditLog.personas.cashier = {
    directQuantityInput: directQtySupported,
    changeCalculatorPresent: changeCalcVerified,
    confirmationModalWorks: confirmationModalVerified,
    receiptModalInPage: receiptModalVerified
  };

  console.log('--- 2. PERSONA: ANBARDAR (WAREHOUSE STAFF) ---');
  // Receipts page
  let receiptsStatus = 0;
  page.on('response', r => { if (r.url().includes('/api/admin/receipts') && r.request().method() === 'GET') receiptsStatus = r.status(); });
  await page.goto('http://localhost:3000/admin/receipts', { waitUntil: 'networkidle' });
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, '02-warehouse-receipts.png') });

  // New receipt modal
  const newReceiptBtn = page.getByRole('button', { name: /Yeni qəbz/i });
  let receiptLineItemsSupported = false;
  if (await newReceiptBtn.isVisible()) {
    await newReceiptBtn.click();
    await page.waitForTimeout(600);
    const modalText = await page.innerText('body');
    receiptLineItemsSupported = modalText.includes('Sətir əlavə et') || modalText.includes('Sətirlər');
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, '02-warehouse-new-receipt-modal.png') });
    const closeBtn = page.locator('button').filter({ hasText: /İmtina|Ləğv|✕/i }).last();
    if (await closeBtn.isVisible()) await closeBtn.click();
  }

  // Stocktakes page
  let stocktakesStatus = 0;
  page.on('response', r => { if (r.url().includes('/api/admin/stocktakes') && r.request().method() === 'GET') stocktakesStatus = r.status(); });
  await page.goto('http://localhost:3000/admin/stocktakes', { waitUntil: 'networkidle' });
  const stocktakesBody = await page.innerText('body');
  const stocktakesForbidden = stocktakesBody.includes('Forbidden') || stocktakesStatus === 403;
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, '02-warehouse-stocktakes.png') });

  // Reorder page
  let reorderStatus = 0;
  page.on('response', r => { if (r.url().includes('/api/admin/inventory/signals/reorder')) reorderStatus = r.status(); });
  await page.goto('http://localhost:3000/admin/inventory/reorder', { waitUntil: 'networkidle' });
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, '02-warehouse-reorder.png') });

  // Reservations page
  let reservationsStatus = 0;
  page.on('response', r => { if (r.url().includes('/api/admin/reservations') && r.request().method() === 'GET') reservationsStatus = r.status(); });
  await page.goto('http://localhost:3000/admin/reservations', { waitUntil: 'networkidle' });
  const reservationsBody = await page.innerText('body');
  const reservationsForbidden = reservationsBody.includes('Forbidden') || reservationsStatus === 403;
  const rawKeyPresent = reservationsBody.includes('Admin.Nav.reservations');
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, '02-warehouse-reservations.png') });

  // Inventory page (StockCell inline adjustment)
  await page.goto('http://localhost:3000/admin/inventory', { waitUntil: 'networkidle' });
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, '02-warehouse-inventory-stock.png') });

  auditLog.personas.warehouse = {
    receiptLineItemsInModal: receiptLineItemsSupported,
    stocktakesForbidden: stocktakesForbidden,
    reorderStatus: reorderStatus || 200,
    reservationsForbidden: reservationsForbidden,
    rawReservationKeyPresent: rawKeyPresent
  };

  console.log('--- 3. PERSONA: MENECER / SAHİBKAR (STORE OWNER / MANAGER) ---');
  await page.goto('http://localhost:3000/admin', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);
  const dashboardText = await page.innerText('body');
  const activeDateLabelAz = dashboardText.includes('Bu ay');
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, '03-manager-dashboard.png') });

  // Margins report page
  await page.goto('http://localhost:3000/admin/reports/margins', { waitUntil: 'networkidle' });
  const marginsUrl = page.url();
  const marginsBody = await page.innerText('body');
  const marginPageLoaded = marginsUrl.includes('/admin/reports/margins') && (marginsBody.includes('Marja') || marginsBody.includes('Mənfəət') || marginsBody.includes('Margin'));
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, '03-manager-margins.png') });

  // Users page and staff filter tabs
  await page.goto('http://localhost:3000/admin/users', { waitUntil: 'networkidle' });
  const usersBody = await page.innerText('body');
  const hasStaffTab = usersBody.includes('Yalnız İşçilər') || usersBody.includes('İşçilər');
  const hasCustomerTab = usersBody.includes('Müştərilər');
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, '03-manager-users-tabs.png') });

  // Coupons page localization
  await page.goto('http://localhost:3000/admin/coupons', { waitUntil: 'networkidle' });
  const newCouponBtn = page.getByRole('button', { name: /Yeni kupon|Kupon əlavə et/i }).first();
  let turkishPlaceholderFound = false;
  if (await newCouponBtn.isVisible()) {
    await newCouponBtn.click();
    await page.waitForTimeout(400);
    const couponModalText = await page.innerText('body');
    turkishPlaceholderFound = couponModalText.includes('İsteğe bağlı');
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, '03-manager-coupon-modal.png') });
    const closeCoupon = page.locator('button').filter({ hasText: /İmtina|Ləğv|✕/i }).last();
    if (await closeCoupon.isVisible()) await closeCoupon.click();
  }

  auditLog.personas.manager = {
    activeDateFilterIsAz: activeDateLabelAz,
    marginReportPageAccessible: marginPageLoaded,
    staffFilterTabsPresent: hasStaffTab && hasCustomerTab,
    turkishPlaceholderFixed: !turkishPlaceholderFound
  };

  console.log('--- 4. PERSONA: SON ALICI (END CUSTOMER) ---');
  await page.goto('http://localhost:3000/az', { waitUntil: 'networkidle' });
  const homeText = await page.innerText('body');
  const bogusDealPresent = homeText.includes('dsdvsdv');
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, '04-customer-homepage.png') });

  // PDP Breadcrumbs & Size Guide
  const productCard = page.locator('a[href*="/products/"]').first();
  let duplicateBreadcrumbsFound = false;
  let sizeGuideWorks = false;
  if (await productCard.isVisible()) {
    await productCard.click();
    await page.waitForTimeout(800);
    const breadcrumbCount = await page.locator('nav[aria-label="Breadcrumb"]').count();
    duplicateBreadcrumbsFound = breadcrumbCount > 1;
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, '04-customer-pdp.png') });

    const sizeGuideLink = page.locator('a[href*="size-guide"], button').filter({ hasText: /Ölçü cədvəli|Size guide/i }).first();
    if (await sizeGuideLink.isVisible()) {
      await sizeGuideLink.click();
      await page.waitForTimeout(800);
      const sizeGuideText = await page.innerText('body');
      sizeGuideWorks = sizeGuideText.includes('Ölçü') && !sizeGuideText.includes('404');
      await page.screenshot({ path: path.join(SCREENSHOT_DIR, '04-customer-size-guide.png') });
    }
  }

  // Cart Drawer Auto-Close & Checkout
  await page.goto('http://localhost:3000/az/products', { waitUntil: 'networkidle' });
  const addToCartBtn = page.locator('button').filter({ hasText: /Səbətə at|Add to cart/i }).first();
  let drawerAutoClosed = false;
  let deliveryFeeCalculated = false;
  if (await addToCartBtn.isVisible()) {
    await addToCartBtn.click();
    await page.waitForTimeout(800);
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, '04-customer-cart-open.png') });

    const checkoutBtn = page.locator('a[href*="/checkout"], button').filter({ hasText: /Sifariş ver|Checkout/i }).first();
    if (await checkoutBtn.isVisible()) {
      await checkoutBtn.click();
      await page.waitForTimeout(1000);
      const cartDrawer = page.locator('[role="dialog"]').filter({ hasText: /Səbətiniz|Your Cart/i });
      drawerAutoClosed = !await cartDrawer.isVisible();
      await page.screenshot({ path: path.join(SCREENSHOT_DIR, '04-customer-checkout-open.png') });

      const checkoutText = await page.innerText('body');
      deliveryFeeCalculated = checkoutText.includes('5.00 AZN') || checkoutText.includes('5 AZN');
    }
  }

  // Checkout Form State Persistence across Language Switch
  await page.goto('http://localhost:3000/az/checkout', { waitUntil: 'networkidle' });
  const nameInput = page.locator('input[name="fullName"], input[placeholder*="Ad"], input[type="text"]').first();
  let draftPersisted = false;
  if (await nameInput.isVisible()) {
    await nameInput.fill('Əli Məmmədov');
    await page.waitForTimeout(400);

    // Switch language to RU
    const langBtn = page.locator('button, a').filter({ hasText: /^RU$/ }).first();
    if (await langBtn.isVisible()) {
      await langBtn.click();
      await page.waitForTimeout(1200);
      const nameInputAfter = page.locator('input[name="fullName"], input[type="text"]').first();
      const val = await nameInputAfter.inputValue().catch(() => '');
      draftPersisted = val === 'Əli Məmmədov';
      await page.screenshot({ path: path.join(SCREENSHOT_DIR, '04-customer-checkout-lang-switch.png') });
    }
  }

  // Mobile Viewport Test (390x844)
  console.log('--- 5. PERSONA: UX/UI & MOBILE VIEWPORT AUDIT ---');
  const mobileContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true
  });
  const mobilePage = await mobileContext.newPage();
  await mobilePage.goto('http://localhost:3000/az', { waitUntil: 'networkidle' });
  const scrollWidth = await mobilePage.evaluate(() => document.documentElement.scrollWidth);
  const clientWidth = await mobilePage.evaluate(() => document.documentElement.clientWidth);
  const mobileOverflow = scrollWidth > clientWidth;
  await mobilePage.screenshot({ path: path.join(SCREENSHOT_DIR, '05-mobile-390px-home.png') });

  auditLog.personas.customer = {
    bogusDealFiltered: !bogusDealPresent,
    duplicateBreadcrumbs: duplicateBreadcrumbsFound,
    sizeGuideWorks: sizeGuideWorks,
    drawerAutoClosedOnCheckout: drawerAutoClosed,
    deliveryFeeCalculatedProperly: deliveryFeeCalculated,
    draftPersistedAcrossLocale: draftPersisted
  };

  auditLog.personas.uxExpert = {
    viewportTested: '390x844',
    scrollWidth: scrollWidth,
    clientWidth: clientWidth,
    horizontalScrollDetected: mobileOverflow,
    isResponsive: !mobileOverflow
  };

  await browser.close();

  fs.writeFileSync(
    path.join(SCREENSHOT_DIR, 'audit-v2-results.json'),
    JSON.stringify(auditLog, null, 2)
  );
  console.log('=== AUDIT COMPLETE ===');
  console.log(JSON.stringify(auditLog, null, 2));
}

runAudit().catch(console.error);
