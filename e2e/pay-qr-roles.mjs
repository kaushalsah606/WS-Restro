import { chromium } from 'playwright';

const FRONT = 'http://localhost:8080';
const API = 'http://localhost:5000';
const BRANCH = 'b1c2d3e4-f5a6-7890-bcde-f12345678901';
const browser = await chromium.launch();
const problems = [];
const mk = async () => {
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 1000 } });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => problems.push(`pageerror: ${String(e).slice(0, 200)}`));
  p.on('console', (m) => m.type() === 'error' && problems.push(`console: ${m.text().slice(0, 200)}`));
  p.on('requestfailed', (r) => r.url().startsWith(API) && problems.push(`FAILED ${r.url()}`));
  p.on('response', (r) => {
    if (r.url().startsWith(API) && r.status() >= 400 && !r.url().includes('/auth/login')) problems.push(`HTTP ${r.status()} ${r.request().method()} ${r.url().replace(API, '')}`);
  });
  return p;
};
const step = (m) => console.log(`• ${m}`);

// ───────── 1. cashier signs in and pays the pending bill through the UI
const cashier = await mk();
await cashier.goto(`${FRONT}/auth`, { waitUntil: 'networkidle' });
await cashier.fill('input[type="email"]', 'cashier@harmonyhub.com');
await cashier.fill('input[type="password"]', 'Cashier@123');
await cashier.click('button[type="submit"]');
await cashier.waitForFunction(() => localStorage.getItem('accessToken'));
await cashier.waitForTimeout(2500);
step('cashier logged in (role-scoped token)');
await cashier.screenshot({ path: 'cashier-dash.png' });
await cashier.getByRole('button', { name: /^\s*Billing\s*$/ }).first().click();
await cashier.waitForTimeout(2000);
await cashier.getByRole('button', { name: /Pay Now/i }).first().click();
await cashier.waitForTimeout(1000);
await cashier.screenshot({ path: 'pay-dialog.png' });
// the dialog is pre-filled with the full amount in cash
await cashier.getByRole('button', { name: /Complete Payment|Confirm|Pay ₹|Process/i }).last().click();
await cashier.waitForTimeout(2500);
const body = await cashier.locator('body').innerText();
step(`payment toast/state: ${/Payment successful|No Bills Pending/i.test(body) ? 'paid ✓' : 'check screenshot'}`);
await cashier.screenshot({ path: 'after-pay.png' });

// ───────── 2. customer scans the QR (no login at all)
const tablesRes = await (await fetch(`${API}/api/v1/tables?branchId=${BRANCH}`)).json();
const free = tablesRes.data.find((t) => t.status === 'available');
const guest = await mk();
await guest.goto(`${FRONT}/order?branch=${BRANCH}&table=${free.id}`, { waitUntil: 'networkidle' });
await guest.waitForTimeout(1500);
await guest.screenshot({ path: 'qr-menu.png' });
const guestText = await guest.locator('body').innerText();
step(`QR menu loaded without login: ${/Harmony Hub/.test(guestText)} (restaurant name), items: ${/Butter Chicken/.test(guestText)}`);
await guest.getByRole('button', { name: /Main Course/i }).first().click().catch(() => {});
await guest.waitForTimeout(500);
const addBtn = guest.locator('button:has(svg.lucide-plus)').first();
await addBtn.click();
await guest.waitForTimeout(400);
await guest.getByRole('button', { name: /View Cart|Cart|Place Order/i }).first().click().catch(() => {});
await guest.waitForTimeout(800);
await guest.getByRole('button', { name: /Place Order/i }).first().click();
await guest.waitForTimeout(2500);
await guest.screenshot({ path: 'qr-placed.png' });
const after = await guest.locator('body').innerText();
step(`guest order placed: ${/Order Received|QR-/.test(after)}`);

// staff updates it -> guest sees live status via Socket.IO (no reload)
const login = await (await fetch(`${API}/api/v1/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'admin@harmonyhub.com', password: 'Admin@12345' }) })).json();
const H = { 'content-type': 'application/json', authorization: `Bearer ${login.data.accessToken}` };
const orders = (await (await fetch(`${API}/api/v1/orders?status=pending`, { headers: H })).json()).data;
const mine = orders.find((o) => o.tableId === free.id);
await fetch(`${API}/api/v1/orders/${mine.id}/status`, { method: 'PATCH', headers: H, body: JSON.stringify({ status: 'preparing' }) });
await guest.waitForTimeout(1800);
const live = await guest.locator('body').innerText();
step(`guest page updated live to "Preparing" (socket, no reload): ${/Preparing/i.test(live)}`);
await guest.screenshot({ path: 'qr-live.png' });
await fetch(`${API}/api/v1/orders/${mine.id}/status`, { method: 'PATCH', headers: H, body: JSON.stringify({ status: 'cancelled' }) });
await fetch(`${API}/api/v1/tables/${free.id}/status`, { method: 'PATCH', headers: H, body: JSON.stringify({ status: 'available' }) });

// ───────── 3. waiter + kitchen roles see only their screens and load without errors
for (const [email, pw, expect] of [['waiter@harmonyhub.com', 'Waiter@123', 'Tables'], ['kitchen@harmonyhub.com', 'Kitchen@123', 'Kitchen']]) {
  const p = await mk();
  await p.goto(`${FRONT}/auth`, { waitUntil: 'networkidle' });
  await p.fill('input[type="email"]', email);
  await p.fill('input[type="password"]', pw);
  await p.click('button[type="submit"]');
  await p.waitForFunction(() => localStorage.getItem('accessToken'));
  await p.waitForTimeout(2500);
  const nav = await p.locator('aside, nav').first().innerText();
  step(`${email.split('@')[0]} dashboard loads; sidebar: ${nav.replace(/\s+/g, ' ').slice(0, 90)}`);
  await p.screenshot({ path: `${email.split('@')[0]}.png` });
}

console.log(problems.length ? `\n${problems.length} problem(s):\n  ${[...new Set(problems)].join('\n  ')}` : '\nno problems');
await browser.close();
