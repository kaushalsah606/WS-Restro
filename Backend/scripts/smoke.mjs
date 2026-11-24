// End-to-end smoke test against a running stack:  node scripts/smoke.mjs [baseUrl]
// Exercises REST + Kafka -> Socket.IO + BullMQ + OpenSearch together.
// Expects the seeded database (npm run db:seed) and is safe to re-run (it cleans up what it creates).
import { io } from 'socket.io-client';

const BASE = process.argv[2] ?? process.env.API_URL ?? 'http://localhost:5000';
const API = `${BASE}/api/v1`;
const ADMIN = { email: process.env.SEED_ADMIN_EMAIL ?? 'admin@harmonyhub.com', password: process.env.SEED_ADMIN_PASSWORD ?? 'Admin@12345' };
const BRANCH = process.env.SEED_BRANCH_ID ?? 'b1c2d3e4-f5a6-7890-bcde-f12345678901';

let token = '';
let passed = 0;
let failed = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function call(method, path, body, { auth = true, expect = [200, 201] } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...(auth && token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!expect.includes(res.status)) throw new Error(`${method} ${path} -> ${res.status} ${JSON.stringify(json).slice(0, 300)}`);
  return json.data ?? json;
}

async function step(name, fn) {
  try {
    const out = await fn();
    passed++;
    console.log(`  ✓ ${name}`);
    return out;
  } catch (e) {
    failed++;
    console.log(`  ✗ ${name}\n      ${e.message}`);
  }
}
const assert = (c, m) => {
  if (!c) throw new Error(m);
};

console.log(`Smoke test against ${API}`);

await step('health: all dependencies up', async () => {
  const h = await (await fetch(`${BASE}/health`)).json();
  assert(h.data.checks.postgres === 'up' && h.data.checks.redis === 'up', JSON.stringify(h));
});

await step('auth: login as admin', async () => {
  const r = await call('POST', '/auth/login', ADMIN, { auth: false });
  token = r.accessToken;
  assert(token && r.refreshToken && r.roles.length, 'missing tokens/roles');
});

await step('auth: wrong password rejected', () => call('POST', '/auth/login', { email: ADMIN.email, password: 'nope-nope' }, { auth: false, expect: [401] }));
await step('auth: protected route without token -> 401', () => call('GET', '/orders', null, { auth: false, expect: [401] }));
await step('auth: profile', async () => assert((await call('GET', '/auth/profile')).user.email === ADMIN.email, 'bad profile'));

const tables = await step('tables: list', async () => {
  const t = await call('GET', `/tables?branchId=${BRANCH}`);
  assert(t.length >= 12, `expected seeded tables, got ${t.length}`);
  return t;
});
// a previously aborted run may have left a dish switched off
for (const m of (await call('GET', `/menu/items?branchId=${BRANCH}`)).filter((x) => !x.isAvailable)) await call('PATCH', `/menu/items/${m.id}/availability`, { isAvailable: true });
const menu = await step('menu: list items', async () => {
  const m = await call('GET', `/menu/items?branchId=${BRANCH}`, null, { auth: false });
  assert(m.length >= 10 && typeof m[0].price === 'number', 'menu empty or price not numeric');
  return m;
});
// make the run repeatable: tables left "cleaning" by a previous run (or by demo payments) go back into service
for (const t of await call('GET', `/tables?branchId=${BRANCH}&status=cleaning`)) await call('PATCH', `/tables/${t.id}/status`, { status: 'available' });
// tables left 'cleaning' (previous run, or just paid) go back into service so every step finds free tables
const free = async () => {
  for (const t of await call('GET', `/tables?branchId=${BRANCH}&status=cleaning`)) await call('PATCH', `/tables/${t.id}/status`, { status: 'available' });
  return call('GET', `/tables?branchId=${BRANCH}&status=available`);
};
const table = (await free())[0];
const item = (n) => menu.find((m) => m.name === n);
const mk = (tableId, items) => call('POST', '/orders', { branchId: BRANCH, tableId, items });
const cancel = (id) => call('PATCH', `/orders/${id}/status`, { status: 'cancelled' });

// realtime listener (staff socket)
const events = [];
const socket = io(BASE, { auth: { token }, transports: ['websocket'] });
await new Promise((res) => socket.on('connect', res));
socket.emit('join:branch', BRANCH);
socket.emit('join:kitchen', BRANCH);
for (const ev of ['order:created', 'order:new', 'order:updated', 'order:status:changed', 'table:updated', 'kot:created', 'bill:updated', 'notification']) socket.on(ev, () => events.push(ev));
await sleep(500);

const order = await step('orders: create (dine-in) + KOT', async () => {
  const o = await call('POST', '/orders', {
    branchId: BRANCH,
    tableId: table.id,
    items: [
      { menuItemId: item('Butter Chicken').id, quantity: 2, notes: 'less spicy' },
      { menuItemId: item('Mango Lassi').id, quantity: 1 },
    ],
  });
  assert(o.items.length === 2 && o.status === 'pending', 'bad order');
  // 2*380 + 120 = 880 ; 5% tax + 5% service
  assert(o.subtotal === 880 && o.tax === 44 && o.serviceCharge === 44 && o.total === 968, `bad totals ${o.subtotal}/${o.tax}/${o.serviceCharge}/${o.total}`);
  assert(o.items.every((i) => i.kotPrinted), 'KOT not generated');
  return o;
});

await step('tables: table is occupied with currentOrderId', async () => {
  const t = await call('GET', `/tables/${table.id}`);
  assert(t.status === 'occupied' && t.currentOrderId === order.id, `got ${t.status}`);
});

await step('orders: second order on same table appends to the running order', async () => {
  const o = await call('POST', '/orders', { branchId: BRANCH, tableId: table.id, items: [{ menuItemId: item('Gulab Jamun').id, quantity: 1 }] });
  assert(o.id === order.id && o.appendedToExisting && o.items.length === 3, 'did not append');
});

await step('kitchen: open KOTs visible', async () => {
  const k = await call('GET', '/kitchen/kots');
  assert(k.length >= 2, `expected KOTs, got ${k.length}`);
});

await step('orders: invalid transition rejected (pending -> served)', () => call('PATCH', `/orders/${order.id}/status`, { status: 'served' }, { expect: [409] }));
await step('orders: preparing -> ready', async () => {
  await call('PATCH', `/orders/${order.id}/status`, { status: 'preparing' });
  const r = await call('PATCH', `/orders/${order.id}/status`, { status: 'ready' });
  assert(r.status === 'ready', 'not ready');
});

const bill = await step('billing: checkout with split payment (card + cash overpay)', async () => {
  const b = await call('POST', `/billing/orders/${order.id}/checkout`, {
    payments: [
      { method: 'card', amount: 500, reference: 'VISA-1234' },
      { method: 'cash', amount: 1000 },
    ],
  });
  assert(b.status === 'completed', `bill ${b.status}`);
  assert(b.change > 0, 'expected change for cash overpayment');
  return b;
});

await step('billing: order paid/served and table moved to cleaning', async () => {
  const o = await call('GET', `/orders/${order.id}`);
  const t = await call('GET', `/tables/${table.id}`);
  assert(o.status === 'served' && o.isPaid, `order ${o.status}`);
  assert(t.status === 'cleaning' && !t.currentOrderId, `table ${t.status}`);
});

await step('billing: paying a settled bill is rejected', () => call('POST', `/billing/${bill.id}/payments`, { method: 'cash', amount: 10 }, { expect: [409] }));

await step('customer QR flow: public menu + order without login', async () => {
  const t = (await free())[0];
  const pub = await call('GET', `/public/menu?branchId=${BRANCH}`, null, { auth: false });
  assert(pub.length >= 4 && pub[0].menuItems.length, 'public menu empty');
  const o = await call('POST', '/public/orders', { branchId: BRANCH, tableId: t.id, sessionId: 'smoke-session', items: [{ menuItemId: item('Paneer Tikka').id, quantity: 1 }] }, { auth: false });
  assert(o.orderNumber.startsWith('QR-'), 'bad number');
  await cancel(o.id);
});

await step('inventory: recipe auto-deduction ran (BullMQ worker)', async () => {
  await sleep(2500);
  const inv = await call('GET', '/inventory');
  const chicken = inv.find((i) => i.name === 'Chicken');
  const tx = await call('GET', `/inventory/${chicken.id}/transactions`);
  assert(tx.some((t) => t.transactionType === 'usage'), 'no usage transaction recorded');
});

await step('inventory: manual stock update + insufficient stock guard', async () => {
  const inv = (await call('GET', '/inventory')).find((i) => i.name === 'Milk');
  await call('POST', `/inventory/${inv.id}/stock`, { type: 'purchase', quantity: 5, notes: 'smoke' });
  await call('POST', `/inventory/${inv.id}/stock`, { type: 'usage', quantity: 100000 }, { expect: [409] });
});

await step('reservations: create, conflict detection, status', async () => {
  const t = tables.find((x) => x.capacity >= 4);
  const day = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  const r = await call('POST', '/reservations', { branchId: BRANCH, tableId: t.id, customerName: 'Smoke Test', customerPhone: '9999999999', partySize: 2, reservationDate: day, reservationTime: '19:00' });
  await call('POST', '/reservations', { branchId: BRANCH, tableId: t.id, customerName: 'Clash', customerPhone: '1', partySize: 2, reservationDate: day, reservationTime: '19:30' }, { expect: [409] });
  await call('PATCH', `/reservations/${r.id}/status`, { status: 'cancelled' });
});

await step('reports: dashboard + sales', async () => {
  const d = await call('GET', '/reports/dashboard');
  assert(d.todaySales >= 968 && d.totalTables >= 12, `dashboard ${JSON.stringify(d).slice(0, 200)}`);
  const s = await call('GET', '/reports/sales?period=week');
  assert(Array.isArray(s) && s.length === 7, 'sales series');
  const o = await call('GET', '/billing/reports?period=week');
  assert(o.summary && o.topItems, 'composite report');
});

await step('search: OpenSearch finds menu (typo-tolerant) + order', async () => {
  await sleep(2500); // indexer is async via Kafka
  const m = await call('GET', `/search/menu?q=panner&branchId=${BRANCH}`, null, { auth: false });
  assert(m.engine === 'opensearch' && m.results.length > 0, `menu search: ${m.engine} ${m.results.length}`);
  const o = await call('GET', `/search/orders?q=${order.orderNumber}`);
  assert(o.results.length > 0, 'order not indexed');
});

await step('printers: CRUD + test job processed by BullMQ', async () => {
  const p = await call('POST', '/printers', { name: 'Smoke Printer', connectionType: 'usb', printFor: ['kot', 'bill'] });
  const job = await call('POST', `/printers/${p.id}/test`);
  assert(job.id, 'no job');
  await sleep(1500);
  const jobs = await call('GET', '/printers/jobs');
  assert(jobs.some((j) => j.id === job.id && ['delegated', 'completed'].includes(j.status)), 'job not processed');
  await call('DELETE', `/printers/${p.id}`);
});

// ───────────── advanced flows ─────────────

await step('billing: partial bill (pay one dish, rest stays open)', async () => {
  const [t1] = await free();
  const o = await mk(t1.id, [{ menuItemId: item('Biryani').id, quantity: 2 }]);
  const b = await call('POST', '/billing/partial', { orderId: o.id, items: [{ itemId: o.items[0].id, quantity: 1 }], method: 'upi' });
  assert(b.kind === 'partial' && b.status === 'completed', 'partial bill not completed');
  assert(b.subtotal === 350, `wrong partial subtotal ${b.subtotal}`);
  const after = await call('GET', `/orders/${o.id}`);
  assert(!after.isPaid && after.subtotal === 350, `order should stay open with 1 biryani, subtotal=${after.subtotal}`);
  await cancel(o.id);
});

await step('billing: merged bill for two orders', async () => {
  const [a, b] = await free();
  const o1 = await mk(a.id, [{ menuItemId: item('Paneer Tikka').id, quantity: 1 }]);
  const o2 = await mk(b.id, [{ menuItemId: item('Gulab Jamun').id, quantity: 2 }]);
  const m = await call('POST', '/billing/merge', { orderIds: [o1.id, o2.id], method: 'cash' });
  assert(m.kind === 'merged' && m.status === 'completed' && m.orderIds.length === 2, 'merge failed');
  assert(m.subtotal === 550, `merge subtotal ${m.subtotal}`);
});

await step('billing: 10% discount recalculates tax + service', async () => {
  const [c] = await free();
  const o = await mk(c.id, [{ menuItemId: item('Butter Chicken').id, quantity: 1 }]);
  const bill = await call('POST', `/billing/orders/${o.id}/generate`);
  const d = await call('POST', `/billing/${bill.id}/discount`, { discount: 10, type: 'percent' });
  assert(d.discount === 38 && d.total === 376.2, `discount math ${JSON.stringify([d.discount, d.total])}`);
  const paid = await call('POST', `/billing/${bill.id}/payments`, { method: 'card', amount: d.total });
  assert(paid.status === 'completed', 'not completed');
});

await step('tables: shift order, merge tables, unmerge, cancel frees table', async () => {
  const [a, b, c] = await free();
  const o = await mk(a.id, [{ menuItemId: item('Fresh Lime Soda').id, quantity: 1 }]);
  const shifted = await call('POST', `/tables/${a.id}/shift`, { toTableId: b.id });
  assert(shifted.status === 'occupied' && shifted.currentOrderId === o.id, 'shift failed');
  assert((await call('GET', `/tables/${a.id}`)).status === 'available', 'source not freed');
  const merged = await call('POST', `/tables/${b.id}/merge`, { tableIds: [c.id] });
  assert(merged.mergedWith.includes(c.id), 'merge missing child');
  await call('POST', `/tables/${b.id}/unmerge`);
  assert((await call('GET', `/tables/${c.id}`)).status === 'available', 'child not released');
  await cancel(o.id);
  assert((await call('GET', `/tables/${b.id}`)).status === 'available', 'cancel did not free table');
});

await step('tables: split items to another table', async () => {
  const [a, b] = await free();
  const o = await mk(a.id, [{ menuItemId: item('Mango Lassi').id, quantity: 2 }, { menuItemId: item('Ice Cream Sundae').id, quantity: 1 }]);
  const r = await call('POST', `/tables/${a.id}/split`, { targetTableId: b.id, itemIds: [o.items[0].id], quantities: { [o.items[0].id]: 1 } });
  assert(r.target.tableId === b.id && r.target.items.length === 1 && r.source.items.some((i) => i.quantity === 1), 'split wrong');
  await cancel(r.source.id);
  await cancel(r.target.id);
});

await step('menu: unavailable item cannot be ordered', async () => {
  const [a] = await free();
  const sundae = item('Ice Cream Sundae');
  await call('PATCH', `/menu/items/${sundae.id}/availability`, { isAvailable: false });
  await call('POST', '/orders', { branchId: BRANCH, tableId: a.id, items: [{ menuItemId: sundae.id, quantity: 1 }] }, { expect: [409] });
  await call('PATCH', `/menu/items/${sundae.id}/availability`, { isAvailable: true });
});

await step('staff: create waiter, list, role guard, deactivate', async () => {
  const email = `smoke${Date.now()}@test.com`;
  const u = await call('POST', '/auth/users', { email, password: 'Passw0rd!x', fullName: 'Smoke Waiter', role: 'WAITER', branchId: BRANCH });
  assert(u.roles[0].role === 'WAITER', 'role');
  const list = await call('GET', '/auth/users?role=WAITER');
  assert(list.some((x) => x.id === u.id), 'not listed');
  const w = await call('POST', '/auth/login', { email, password: 'Passw0rd!x' }, { auth: false });
  const res = await fetch(`${API}/auth/users`, { headers: { authorization: `Bearer ${w.accessToken}` } });
  assert(res.status === 403, `waiter must not list staff, got ${res.status}`);
  await call('DELETE', `/auth/users/${u.id}`);
  await call('POST', '/auth/login', { email, password: 'Passw0rd!x' }, { auth: false, expect: [403] });
});

await step('auth: refresh token + snake_case compatibility', async () => {
  const l = await call('POST', '/auth/login', ADMIN, { auth: false });
  const r = await call('POST', '/auth/refresh-token', { refreshToken: l.refreshToken }, { auth: false });
  assert(r.accessToken, 'no access token');
  assert(r.refreshToken && r.refreshToken !== l.refreshToken, 'refresh token was not rotated');
  const reuse = await fetch(`${API}/auth/refresh-token`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ refreshToken: l.refreshToken }) });
  assert(reuse.status === 401, 'old refresh token must be rejected after rotation');
  const res = await fetch(`${API}/tables?branch_id=${BRANCH}`, { headers: { authorization: `Bearer ${r.accessToken}`, 'x-response-case': 'snake' } });
  const j = await res.json();
  assert(j.data[0].table_number !== undefined, 'snake_case response missing');
});

await step('realtime: Kafka -> Socket.IO events arrived', async () => {
  await sleep(500);
  const need = ['order:created', 'kot:created', 'order:status:changed', 'table:updated'];
  const missing = need.filter((e) => !events.includes(e));
  assert(missing.length === 0, `missing events: ${missing.join(', ')} (got ${[...new Set(events)].join(', ')})`);
});

await step('realtime: anonymous socket cannot join branch room', async () => {
  const anon = io(BASE, { transports: ['websocket'] });
  await new Promise((res) => anon.on('connect', res));
  const ack = await anon.timeout(3000).emitWithAck('join:branch', BRANCH);
  anon.close();
  assert(ack.ok === false, 'anonymous join was allowed');
});

socket.close();
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
