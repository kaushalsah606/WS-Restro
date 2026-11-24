import { chromium } from 'playwright';

const FRONT = process.env.FRONT ?? 'http://localhost:8080';
const API = 'http://localhost:5000';
const who = process.argv[2] ?? 'admin@harmonyhub.com';
const pass = process.argv[3] ?? 'Admin@12345';
const views = (process.argv[4] ?? 'Dashboard,Tables,Orders,Kitchen,Billing,Reservations,Menu,Inventory,Reports,Detailed Reports,Printers,Staff').split(',');

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
const page = await ctx.newPage();

const problems = [];
const apiCalls = [];
page.on('console', (m) => {
  if (m.type() === 'error') problems.push(`console.error: ${m.text().slice(0, 220)}`);
});
page.on('pageerror', (e) => problems.push(`pageerror: ${String(e).slice(0, 220)}`));
page.on('requestfailed', (r) => {
  if (r.url().startsWith(API)) problems.push(`REQUEST FAILED (CORS/network): ${r.method()} ${r.url()} ${r.failure()?.errorText}`);
});
page.on('response', async (r) => {
  if (!r.url().startsWith(API)) return;
  const req = r.request();
  const auth = req.headers()['authorization'];
  apiCalls.push({ m: req.method(), u: r.url().replace(API, ''), s: r.status(), auth: !!auth, acao: r.headers()['access-control-allow-origin'] });
  if (r.status() >= 400 && !/auth\/(login)/.test(r.url())) problems.push(`HTTP ${r.status()} ${req.method()} ${r.url().replace(API, '')}`);
});

console.log(`Frontend ${FRONT} -> API ${API} as ${who}`);
await page.goto(`${FRONT}/auth`, { waitUntil: 'networkidle' });
await page.fill('input[type="email"]', who);
await page.fill('input[type="password"]', pass);
await page.click('button[type="submit"]');
await page.waitForFunction(() => localStorage.getItem('accessToken'), null, { timeout: 15000 });
await page.waitForTimeout(2500);

const tok = await page.evaluate(() => ({ a: !!localStorage.getItem('accessToken'), r: !!localStorage.getItem('refreshToken') }));
console.log(`  token stored: access=${tok.a} refresh=${tok.r}; url=${page.url()}`);

for (const v of views) {
  const before = problems.length;
  const btn = page.getByRole('button', { name: new RegExp(`^\\s*${v}\\s*$`, 'i') }).first();
  if (!(await btn.count())) {
    console.log(`  - ${v}: (not in this role's sidebar)`);
    continue;
  }
  await btn.click();
  await page.waitForTimeout(2200);
  const text = (await page.locator('main, body').first().innerText()).replace(/\s+/g, ' ').slice(0, 110);
  const issues = problems.slice(before);
  console.log(`  ${issues.length ? '✗' : '✓'} ${v}: ${text}`);
  issues.forEach((p) => console.log(`      ${p}`));
}

const calls = apiCalls.filter((c) => !c.auth && !/auth\/(login|refresh|register)|restaurants\/default-branch|^\/tables|^\/menu|^\/public/.test(c.u));
console.log(`  API calls: ${apiCalls.length}, with Bearer token: ${apiCalls.filter((c) => c.auth).length}, CORS header present on all: ${apiCalls.every((c) => c.acao === FRONT)}`);
if (calls.length) console.log('  calls without token:', calls.map((c) => c.u).join(', '));

await page.screenshot({ path: process.env.SHOT ?? 'last.png' });
console.log(problems.length ? `\n${problems.length} problem(s)` : '\nno problems');
await browser.close();
process.exit(problems.length ? 1 : 0);
