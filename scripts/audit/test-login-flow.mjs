import { chromium } from '../../artifacts/store/node_modules/@playwright/test/index.mjs';

async function test() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  console.log('Navigating to http://localhost:3000/admin/counter');
  await page.goto('http://localhost:3000/admin/counter', { waitUntil: 'networkidle' });

  const signInBtn = page.getByRole('button', { name: /Sign In with Phone/i });
  if (await signInBtn.isVisible()) {
    console.log('Clicking Sign In with Phone...');
    await signInBtn.click();
    await page.waitForTimeout(500);

    const phoneInput = page.locator('input[type="tel"]');
    await phoneInput.fill('550000001');
    await page.locator('button[type="submit"]').click();
    await page.waitForTimeout(1000);

    console.log('Filling OTP...');
    const otpInput = page.locator('input[placeholder*="kod"], input[placeholder*="code"], input[type="text"]').last();
    await otpInput.fill('999999');
    await page.locator('button[type="submit"]').click();
    
    // Wait for reload or navigate
    console.log('Waiting for post-login state...');
    await page.waitForTimeout(3000);
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);

    console.log('Current URL:', page.url());
    const bodyText = await page.innerText('body');
    console.log('Body length:', bodyText.length);
    console.log('Body preview:\n', bodyText.slice(0, 400));
  }

  await browser.close();
}

test().catch(console.error);
