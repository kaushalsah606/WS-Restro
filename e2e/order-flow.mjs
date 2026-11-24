import { chromium } from 'playwright';

const FRONT = 'http://localhost:8080';
const API = 'http://localhost:5000';
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
const page = await ctx.newPage();
const problems = [];
const calls = [];
page.on('pageerror', (e) => problems.push(`pageerror: ${String(e).slice(0, 200)}`));
page.on('console', (m) => m.type() === 'error' && problems.push(`console: ${m.text().slice(0, 200)}`));
page.on('requestfailed', (r) => r.url().startsWith(API) && problems.push(`FAILED ${r.url()}`));
page.on('response', (r) => {
  if (!r.url().startsWith(API) || r.url().includes('socket.io')) return;
  const q = r.request();
  calls.push(`${q.method()} ${r.url().replace(API, '').split('?')[0]} ${r.status()}`);
  if (r.status() >= 400 && !r.url().includes('/auth/login')) problems.push(`HTTP ${r.status()} ${q.method()} ${r.url().replace(API, '')}`);
});
const step = (m) => console.log(`• ${m}`);
const click = async (name) => page.getByRole('button', { name: new RegExp(`^\\s*${name}\\s*$`, 'i') }).first().click();

await page.goto(`${FRONT}/auth`, { waitUntil: 'networkidle' });
await page.fill('input[type="email"]', 'admin@harmonyhub.com');
await page.fill('input[type="password"]', 'Admin@12345');
await page.click('button[type="submit"]');
await page.waitForFunction(() => localStorage.getItem('accessToken'));
await page.waitForTimeout(2000);
step('logged in through the UI');

// ── take an order on a table
await click('Tables');
await page.waitForTimeout(1500);
await page.screenshot({ path: 'tables.png' });
// pick the first card that mentions "Available"
const card = page.locator('text=/^Table\\s*\\d+|^T?\\d{2}$/').first();
const availableCards = page.getByText('Ready for guests');
step(`available table cards found: ${await availableCards.count()}`);
await availableCards.first().click();
await page.waitForTimeout(1200);
await page.screenshot({ path: 'order-panel.png' });

// add items from the panel menu list
for (const dish of ['Butter Chicken', 'Mango Lassi']) {
  await page.locator('button', { hasText: dish }).first().click();
}
step('added 2 dishes to the cart');
await page.getByRole('button', { name: /Place Order/i }).click();
await page.waitForTimeout(2000);
await page.screenshot({ path: 'placed.png' });
const placed = calls.filter((c) => c.startsWith('POST /orders'));
step(`POST /orders => ${placed.join(', ') || 'NOT CALLED'}`);

// ── kitchen picks it up
await click('Kitchen');
await page.waitForTimeout(2000);
await page.screenshot({ path: 'kitchen.png' });
const kitchenText = await page.locator('body').innerText();
step(`kitchen shows the new order: ${/Butter Chicken/i.test(kitchenText)}`);
const startBtn = page.getByRole('button', { name: /Start|Preparing|Accept/i }).first();
if (await startBtn.count()) {
  await startBtn.click();
  await page.waitForTimeout(1200);
  const readyBtn = page.getByRole('button', { name: /Ready/i }).first();
  if (await readyBtn.count()) { await readyBtn.click(); await page.waitForTimeout(1200); }
}
step(`status calls: ${calls.filter((c) => c.startsWith('PATCH /orders')).join(', ') || 'none'}`);

// ── billing
await click('Billing');
await page.waitForTimeout(2000);
await page.screenshot({ path: 'billing.png' });
const billText = await page.locator('body').innerText();
step(`billing lists the order: ${/Pending Bills/i.test(billText)} ${/BILL|ORD-/.test(billText)}`);

console.log('\nAPI calls:', [...new Set(calls)].slice(-14).join('\n  '));
console.log(problems.length ? `\n${problems.length} problem(s):\n  ${problems.join('\n  ')}` : '\nno problems');
await browser.close();
