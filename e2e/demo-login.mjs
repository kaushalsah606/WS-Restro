// Demo mode: the sign-in page offers one-click logins; every role must land on a working dashboard.
import { chromium } from 'playwright';

const FRONT = process.env.FRONT ?? 'http://localhost:8080';
const API = 'http://localhost:5000';
const browser = await chromium.launch();
const problems = [];
let ok = 0;

const labels = ['Super Admin', 'Owner', 'Manager', 'Cashier', 'Waiter', 'Kitchen'];
for (const label of labels) {
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 950 } });
  const page = await ctx.newPage();
  const before = problems.length;
  page.on('pageerror', (e) => problems.push(`${label}: pageerror ${String(e).slice(0, 160)}`));
  page.on('console', (m) => m.type() === 'error' && problems.push(`${label}: console ${m.text().slice(0, 160)}`));
  page.on('requestfailed', (r) => r.url().startsWith(API) && problems.push(`${label}: FAILED ${r.url()}`));
  page.on('response', (r) => r.url().startsWith(API) && r.status() >= 400 && problems.push(`${label}: HTTP ${r.status()} ${r.url().replace(API, '')}`));

  await page.goto(`${FRONT}/auth`, { waitUntil: 'networkidle' });
  if (label === 'Super Admin') await page.screenshot({ path: 'demo-login.png' });
  await page.getByTestId('demo-accounts').getByRole('button', { name: new RegExp(label, 'i') }).click();
  await page.waitForFunction(() => localStorage.getItem('accessToken'), null, { timeout: 15000 });
  await page.waitForTimeout(3000);
  const body = (await page.locator('body').innerText()).replace(/\s+/g, ' ');
  const who = body.match(/(System Admin|Olivia Owner|Maya Manager|Carl Cashier|Wendy Waiter|Kiran Kitchen)/)?.[1] ?? '?';
  await page.screenshot({ path: `demo-${label.replace(' ', '-').toLowerCase()}.png` });
  const clean = problems.length === before;
  if (clean) ok++;
  console.log(`  ${clean ? '✓' : '✗'} ${label.padEnd(12)} -> signed in as ${who}`);
  await ctx.close();
}

console.log(problems.length ? `\n${problems.length} problem(s):\n  ${[...new Set(problems)].join('\n  ')}` : `\nall ${ok} demo logins work, no problems`);
await browser.close();
process.exit(problems.length ? 1 : 0);
