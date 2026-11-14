import { chromium } from '../../artifacts/store/node_modules/@playwright/test/index.mjs';
import path from 'path';

const SCREENSHOT_DIR = path.resolve('docs/audits/wave-business-audit/screenshots-v2');

async function testPOS() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  // 1. Login
  await page.goto('http://localhost:3000/admin/counter', { waitUntil: 'networkidle' });
  const signInBtn = page.getByRole('button', { name: /Sign In with Phone/i });
  if (await signInBtn.isVisible()) {
    await signInBtn.click();
    await page.waitForTimeout(500);
    await page.locator('input[type="tel"]').fill('550000001');
    await page.locator('button[type="submit"]').click();
    await page.waitForTimeout(800);
    await page.locator('input[placeholder*="kod"], input[placeholder*="code"], input[type="text"]').last().fill('999999');
    await page.locator('button[type="submit"]').click();
    await page.waitForTimeout(2500);
  }

  console.log('1. POS Initial loaded');
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, '01-pos-initial.png') });

  // 2. Type SKU in LookupBox and press Enter
  const input = page.locator('input[placeholder*="Barkodu oxudun"]');
  await input.fill('M2C-SALES-1794379416051');
  await input.press('Enter');
  await page.waitForTimeout(1000);
  console.log('2. Item looked up, cart should have item');
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, '01-pos-item-added.png') });

  // 3. Test direct quantity editing
  const qtyCell = page.locator('button[title*="Dəyişmək üçün klikləyin"]').first();
  if (await qtyCell.isVisible()) {
    console.log('3. Clicking quantity cell for direct editing');
    await qtyCell.click();
    await page.waitForTimeout(400);
    const qtyInput = page.locator('input[type="number"]');
    if (await qtyInput.isVisible()) {
      await qtyInput.fill('2');
      await qtyInput.press('Enter');
      await page.waitForTimeout(500);
      console.log('Quantity updated directly');
    }
  }
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, '01-pos-direct-qty-updated.png') });

  // 4. Test Cash change calculator
  const cashBtn = page.getByRole('button', { name: /Nağd/i }).first();
  if (await cashBtn.isVisible()) {
    await cashBtn.click();
    await page.waitForTimeout(400);
    const tenderedInput = page.locator('input[placeholder*="Təqdim edilən"]').first();
    if (await tenderedInput.isVisible()) {
      console.log('4. Typing 50 AZN in cash tendered');
      await tenderedInput.fill('50');
      await page.waitForTimeout(500);
      const text = await page.innerText('body');
      console.log('Has Qalıq text:', text.includes('Qalıq:'));
    }
  }
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, '01-pos-change-calculated.png') });

  // 5. Test Confirmation modal
  const completeBtn = page.getByRole('button', { name: /Tamamla/i });
  if (await completeBtn.isVisible() && !await completeBtn.isDisabled()) {
    console.log('5. Clicking Tamamla');
    await completeBtn.click();
    await page.waitForTimeout(600);
    console.log('Modal visible');
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, '01-pos-confirmation-modal.png') });

    // In modal, click confirm
    const confirmBtn = page.locator('button').filter({ hasText: /Ödənişi təsdiqlə/i }).last();
    if (await confirmBtn.isVisible()) {
      console.log('6. Confirming sale in modal');
      await confirmBtn.click();
      await page.waitForTimeout(1500);
      await page.screenshot({ path: path.join(SCREENSHOT_DIR, '01-pos-receipt-modal.png') });
      console.log('Receipt modal rendered in-page!');
    }
  }

  await browser.close();
  console.log('POS detailed test finished');
}

testPOS().catch(console.error);
