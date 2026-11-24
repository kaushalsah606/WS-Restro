/**
 * Idempotent seed: restaurant, branch (id matches the frontend's NEXT_PUBLIC_BRANCH_ID), demo staff,
 * menu, tables, inventory + recipes. Safe to run on every deploy.
 */
import 'dotenv/config';
import { AppRole, PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

const BRANCH_ID = process.env.SEED_BRANCH_ID ?? 'b1c2d3e4-f5a6-7890-bcde-f12345678901';
const ADMIN_EMAIL = (process.env.SEED_ADMIN_EMAIL ?? 'admin@harmonyhub.com').toLowerCase();
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? 'Admin@12345';
const RESTAURANT_ID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';

async function user(email: string, fullName: string, role: AppRole, password: string, branchId: string | null, restaurantId: string | null) {
  const passwordHash = await bcrypt.hash(password, 10);
  const u = await prisma.user.upsert({
    where: { email },
    update: { fullName },
    create: { email, fullName, passwordHash, phone: '+91 90000 00000' },
  });
  const exists = await prisma.userRole.findFirst({ where: { userId: u.id, role, branchId } });
  if (!exists) await prisma.userRole.create({ data: { userId: u.id, role, branchId, restaurantId } });
  return u;
}

// ───────────────────────── demo data (SEED_DEMO_DATA=true) ─────────────────────────

/** Deterministic PRNG so every environment gets the same demo history. */
function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

async function seedDemoData(branchId: string, restaurantId: string) {
  const rand = rng(20260101);
  const pick = <T>(a: T[]) => a[Math.floor(rand() * a.length)];

  // extra people
  await user('owner@harmonyhub.com', 'Olivia Owner', 'RESTAURANT_ADMIN', 'Owner@123', null, restaurantId);
  const waiter2 = await user('waiter2@harmonyhub.com', 'Wade Waiter', 'WAITER', 'Waiter@123', branchId, restaurantId);
  const waiter1 = await prisma.user.findUniqueOrThrow({ where: { email: 'waiter@harmonyhub.com' } });
  const cashier = await prisma.user.findUniqueOrThrow({ where: { email: 'cashier@harmonyhub.com' } });

  // a few more dishes (breads + soups)
  const extraCats: Record<string, [string, string, number, boolean, number][]> = {
    Breads: [['Butter Naan', 'Tandoor-baked flatbread', 60, true, 6], ['Garlic Naan', 'Naan with garlic & coriander', 80, true, 7], ['Tandoori Roti', 'Whole-wheat roti', 40, true, 5]],
    Soups: [['Tomato Soup', 'Classic creamy tomato soup', 140, true, 8], ['Chicken Clear Soup', 'Light broth with shredded chicken', 170, false, 10]],
  };
  let order = 5;
  for (const [cat, dishes] of Object.entries(extraCats)) {
    const c = await prisma.category.upsert({ where: { branchId_name: { branchId, name: cat } }, update: {}, create: { branchId, name: cat, sortOrder: order++ } });
    for (const [name, description, price, isVeg, preparationTime] of dishes) {
      if (!(await prisma.menuItem.findFirst({ where: { branchId, name } }))) {
        await prisma.menuItem.create({ data: { branchId, categoryId: c.id, name, description, price, isVeg, preparationTime } });
      }
    }
  }

  // ── two weeks of paid order history (drives dashboards & reports)
  const alreadySeeded = await prisma.order.count({ where: { branchId, orderNumber: { contains: '-D' } } });
  if (alreadySeeded === 0) {
    const menu = await prisma.menuItem.findMany({ where: { branchId, isAvailable: true } });
    const tables = await prisma.restaurantTable.findMany({ where: { branchId } });
    const waiters = [waiter1, waiter2];
    const methods = ['cash', 'card', 'upi', 'upi', 'card', 'wallet'] as const;
    const pad = (n: number, w = 2) => String(n).padStart(w, '0');
    let created = 0;

    for (let daysAgo = 14; daysAgo >= 1; daysAgo--) {
      const day = new Date();
      day.setDate(day.getDate() - daysAgo);
      const weekend = [0, 6].includes(day.getDay());
      const count = Math.floor(7 + rand() * 6) + (weekend ? 5 : 0);
      const ymd = `${day.getFullYear()}${pad(day.getMonth() + 1)}${pad(day.getDate())}`;

      for (let n = 1; n <= count; n++) {
        const at = new Date(day);
        // lunch (12-14) and dinner (19-22) peaks
        const hour = rand() < 0.4 ? 12 + Math.floor(rand() * 3) : 19 + Math.floor(rand() * 4);
        at.setHours(hour, Math.floor(rand() * 60), 0, 0);

        const lines = Array.from({ length: 1 + Math.floor(rand() * 4) }, () => ({ item: pick(menu), qty: 1 + Math.floor(rand() * 3) }));
        const subtotal = r2(lines.reduce((s, l) => s + Number(l.item.price) * l.qty, 0));
        const discount = rand() < 0.12 ? r2(subtotal * 0.1) : 0;
        const base = subtotal - discount;
        const tax = r2(base * 0.05);
        const service = r2(base * 0.05);
        const total = r2(base + tax + service);
        const dineIn = rand() < 0.8;
        const cancelled = rand() < 0.04;
        const waiter = pick(waiters);
        const orderNumber = `ORD-${ymd}-D${pad(n, 3)}`;
        const paidAt = new Date(at.getTime() + (35 + Math.floor(rand() * 40)) * 60000);

        await prisma.order.create({
          data: {
            branchId,
            tableId: dineIn ? pick(tables).id : null,
            waiterId: waiter.id,
            orderNumber,
            orderType: dineIn ? 'dine_in' : rand() < 0.6 ? 'takeaway' : 'delivery',
            status: cancelled ? 'cancelled' : 'served',
            subtotal: cancelled ? 0 : subtotal,
            tax: cancelled ? 0 : tax,
            serviceCharge: cancelled ? 0 : service,
            discount: cancelled ? 0 : discount,
            total: cancelled ? 0 : total,
            createdAt: at,
            updatedAt: paidAt,
            servedAt: cancelled ? null : paidAt,
            paidAt: cancelled ? null : paidAt,
            items: {
              create: lines.map((l) => ({
                menuItemId: l.item.id,
                name: l.item.name,
                quantity: l.qty,
                unitPrice: l.item.price,
                total: r2(Number(l.item.price) * l.qty),
                status: cancelled ? 'cancelled' : 'served',
                kotPrinted: true,
                createdAt: at,
              })),
            },
            ...(cancelled
              ? {}
              : {
                  bills: {
                    create: {
                      branchId,
                      billNumber: `BILL-${ymd}-D${pad(n, 3)}`,
                      subtotal,
                      tax,
                      serviceCharge: service,
                      discount,
                      total,
                      status: 'completed',
                      kind: 'full',
                      generatedAt: paidAt,
                      paidAt,
                      generatedById: cashier.id,
                      payments: { create: { method: pick([...methods]), amount: total, receivedById: cashier.id, createdAt: paidAt } },
                    },
                  },
                }),
          },
        });
        created++;
      }
    }
    // link each demo bill to its order (merged-bill join table)
    await prisma.$executeRawUnsafe(`INSERT INTO bill_orders ("billId","orderId") SELECT id,"orderId" FROM bills WHERE "billNumber" LIKE 'BILL-%-D%' ON CONFLICT DO NOTHING`);
    console.log(`  demo history : ${created} orders over the last 14 days`);
  }

  // ── live service right now: three tables mid-meal (pending / preparing / ready)
  if ((await prisma.order.count({ where: { branchId, orderNumber: { startsWith: 'DEMO-LIVE' } } })) === 0) {
    const live: [string, 'pending' | 'preparing' | 'ready', string[]][] = [
      ['10', 'pending', ['Paneer Tikka', 'Fresh Lime Soda']],
      ['02', 'preparing', ['Butter Chicken', 'Butter Naan', 'Mango Lassi']],
      ['05', 'ready', ['Biryani', 'Biryani', 'Gulab Jamun']],
    ];
    let k = 0;
    for (const [tableNumber, status, dishes] of live) {
      const table = await prisma.restaurantTable.findUnique({ where: { branchId_tableNumber: { branchId, tableNumber } } });
      if (!table || table.status !== 'available') continue;
      const items = await Promise.all(dishes.map((d) => prisma.menuItem.findFirstOrThrow({ where: { branchId, name: d } })));
      const grouped = new Map<string, { item: (typeof items)[number]; qty: number }>();
      items.forEach((i) => grouped.set(i.id, { item: i, qty: (grouped.get(i.id)?.qty ?? 0) + 1 }));
      const lines = [...grouped.values()];
      const subtotal = r2(lines.reduce((s, l) => s + Number(l.item.price) * l.qty, 0));
      const tax = r2(subtotal * 0.05);
      const created = new Date(Date.now() - (status === 'pending' ? 4 : status === 'preparing' ? 14 : 27) * 60000);
      const o = await prisma.order.create({
        data: {
          branchId, tableId: table.id, waiterId: waiter1.id, orderNumber: `DEMO-LIVE-${++k}`, orderType: 'dine_in', status,
          subtotal, tax, serviceCharge: tax, total: r2(subtotal + tax * 2), createdAt: created,
          items: { create: lines.map((l) => ({ menuItemId: l.item.id, name: l.item.name, quantity: l.qty, unitPrice: l.item.price, total: r2(Number(l.item.price) * l.qty), status, kotPrinted: true, createdAt: created })) },
        },
        include: { items: true },
      });
      const kot = await prisma.kot.create({ data: { branchId, orderId: o.id, kotNumber: `KOT-DEMO-${k}`, status: status === 'pending' ? 'printed' : status === 'preparing' ? 'acknowledged' : 'completed', createdAt: created } });
      await prisma.orderItem.updateMany({ where: { orderId: o.id }, data: { kotId: kot.id } });
      await prisma.restaurantTable.update({ where: { id: table.id }, data: { status: 'occupied', currentOrderId: o.id } });
    }
    console.log('  live service : 3 open orders (pending / preparing / ready)');
  }

  // ── reservations (today evening + upcoming)
  if ((await prisma.reservation.count({ where: { branchId, customerPhone: { startsWith: '+91 98765' } } })) === 0) {
    const day = (offset: number) => {
      const d = new Date();
      return new Date(`${new Date(d.getTime() + offset * 86400000).toISOString().slice(0, 10)}T00:00:00.000Z`);
    };
    const t = async (n: string) => (await prisma.restaurantTable.findUnique({ where: { branchId_tableNumber: { branchId, tableNumber: n } } }))?.id ?? null;
    const rows = [
      { customerName: 'Aarav Sharma', customerPhone: '+91 98765 00001', partySize: 4, off: 0, time: '20:00', table: '04', status: 'confirmed' as const, note: 'Birthday – small cake please' },
      { customerName: 'Priya Nair', customerPhone: '+91 98765 00002', partySize: 6, off: 0, time: '21:00', table: '03', status: 'pending' as const, note: null },
      { customerName: 'Rahul Mehta', customerPhone: '+91 98765 00003', partySize: 2, off: 1, time: '19:30', table: '07', status: 'confirmed' as const, note: 'Window seat' },
      { customerName: 'Sneha Kapoor', customerPhone: '+91 98765 00004', partySize: 8, off: 2, time: '13:00', table: '12', status: 'confirmed' as const, note: 'Corporate lunch, need projector-free quiet area' },
    ];
    for (const r of rows) {
      await prisma.reservation.create({
        data: { branchId, tableId: await t(r.table), customerName: r.customerName, customerPhone: r.customerPhone, customerEmail: `${r.customerName.split(' ')[0].toLowerCase()}@example.com`, partySize: r.partySize, reservationDate: day(r.off), reservationTime: r.time, status: r.status, specialRequests: r.note },
      });
    }
    console.log('  reservations : 4 (2 today, 2 upcoming)');
  }

  // ── low-stock items so the alerts have something to show
  await prisma.inventoryItem.updateMany({ where: { branchId, name: 'Limes', currentStock: { gt: 50 } }, data: { currentStock: 38 } });
  await prisma.inventoryItem.updateMany({ where: { branchId, name: 'Mango Pulp', currentStock: { gt: 3 } }, data: { currentStock: 2.5 } });

  // ── printers (inactive by default so no jobs fail until real hardware is configured)
  if ((await prisma.printer.count({ where: { branchId } })) === 0) {
    await prisma.printer.createMany({
      data: [
        { branchId, name: 'Kitchen Printer (demo)', type: 'kitchen', connectionType: 'network', ipAddress: '192.168.1.50', port: 9100, isActive: false, printFor: ['kot'] },
        { branchId, name: 'Counter Receipt (demo)', type: 'receipt', connectionType: 'usb', isActive: false, isDefault: true, printFor: ['bill', 'report'] },
      ],
    });
    console.log('  printers     : 2 demo printers (inactive)');
  }

  if ((await prisma.notification.count({ where: { branchId } })) === 0) {
    await prisma.notification.createMany({
      data: [
        { branchId, type: 'inventory.low', title: 'Low stock', message: 'Limes: 38 pcs left (min 50)' },
        { branchId, type: 'reservation.new', title: 'New reservation', message: 'Aarav Sharma · 4 guests · today 20:00' },
      ],
    });
  }
}

async function main() {
  const restaurant = await prisma.restaurant.upsert({
    where: { id: RESTAURANT_ID },
    update: {},
    create: {
      id: RESTAURANT_ID,
      name: 'Harmony Hub',
      address: '12 MG Road, Bengaluru',
      phone: '+91 80 1234 5678',
      email: 'hello@harmonyhub.com',
      currency: 'INR',
      taxRate: 5,
      serviceCharge: 5,
    },
  });

  const branch = await prisma.branch.upsert({
    where: { id: BRANCH_ID },
    update: {},
    create: { id: BRANCH_ID, restaurantId: restaurant.id, name: 'Main Branch', address: restaurant.address, phone: restaurant.phone, openingTime: '10:00', closingTime: '23:30' },
  });

  // ── staff
  await user(ADMIN_EMAIL, 'System Admin', 'SUPER_ADMIN', ADMIN_PASSWORD, null, null);
  await user('manager@harmonyhub.com', 'Maya Manager', 'BRANCH_MANAGER', 'Manager@123', branch.id, restaurant.id);
  await user('cashier@harmonyhub.com', 'Carl Cashier', 'CASHIER', 'Cashier@123', branch.id, restaurant.id);
  await user('waiter@harmonyhub.com', 'Wendy Waiter', 'WAITER', 'Waiter@123', branch.id, restaurant.id);
  await user('kitchen@harmonyhub.com', 'Kiran Kitchen', 'KITCHEN_STAFF', 'Kitchen@123', branch.id, restaurant.id);

  // ── categories & menu
  const catDefs = [
    { name: 'Starters', sortOrder: 1 },
    { name: 'Main Course', sortOrder: 2 },
    { name: 'Beverages', sortOrder: 3 },
    { name: 'Desserts', sortOrder: 4 },
  ];
  const cats: Record<string, string> = {};
  for (const c of catDefs) {
    const row = await prisma.category.upsert({ where: { branchId_name: { branchId: branch.id, name: c.name } }, update: {}, create: { ...c, branchId: branch.id } });
    cats[c.name] = row.id;
  }

  const menu: [string, string, string, number, boolean, number][] = [
    ['Starters', 'Crispy Spring Rolls', 'Vegetable filled crispy rolls', 180, true, 10],
    ['Starters', 'Chicken Wings', 'Spicy buffalo wings', 280, false, 15],
    ['Starters', 'Paneer Tikka', 'Grilled cottage cheese', 250, true, 12],
    ['Main Course', 'Butter Chicken', 'Creamy tomato curry', 380, false, 20],
    ['Main Course', 'Paneer Butter Masala', 'Rich creamy paneer curry', 320, true, 18],
    ['Main Course', 'Biryani', 'Fragrant basmati rice', 350, false, 25],
    ['Beverages', 'Fresh Lime Soda', 'Refreshing citrus drink', 80, true, 3],
    ['Beverages', 'Mango Lassi', 'Sweet mango yogurt', 120, true, 5],
    ['Desserts', 'Gulab Jamun', 'Sweet milk dumplings', 150, true, 5],
    ['Desserts', 'Ice Cream Sundae', 'Vanilla with toppings', 180, true, 8],
  ];
  const items: Record<string, string> = {};
  for (const [cat, name, description, price, isVeg, preparationTime] of menu) {
    const existing = await prisma.menuItem.findFirst({ where: { branchId: branch.id, name } });
    const row =
      existing ??
      (await prisma.menuItem.create({
        data: { branchId: branch.id, categoryId: cats[cat], name, description, price, isVeg, preparationTime },
      }));
    items[name] = row.id;
  }
  // a variant + add-on to demo pricing
  const biryani = items['Biryani'];
  if (!(await prisma.menuVariant.count({ where: { menuItemId: biryani } }))) {
    await prisma.menuVariant.createMany({ data: [{ menuItemId: biryani, name: 'Half', priceModifier: -100 }, { menuItemId: biryani, name: 'Full', priceModifier: 0 }] });
    await prisma.menuAddon.createMany({ data: [{ menuItemId: biryani, name: 'Extra Raita', price: 30 }, { menuItemId: biryani, name: 'Boiled Egg', price: 20 }] });
  }

  // ── tables
  const tableDefs: [string, number, string, string][] = [
    ['01', 4, 'Ground', 'Main Hall'], ['02', 2, 'Ground', 'Main Hall'], ['03', 6, 'Ground', 'Main Hall'], ['04', 4, 'Ground', 'Main Hall'],
    ['05', 8, 'Ground', 'Private'], ['06', 4, 'Ground', 'Main Hall'], ['07', 2, 'Ground', 'Patio'], ['08', 4, 'Ground', 'Patio'],
    ['09', 6, 'First', 'Rooftop'], ['10', 4, 'First', 'Rooftop'], ['11', 2, 'First', 'Rooftop'], ['12', 8, 'First', 'VIP'],
  ];
  const frontend = process.env.FRONTEND_URL ?? 'http://localhost:8080';
  for (const [tableNumber, capacity, floor, area] of tableDefs) {
    const t = await prisma.restaurantTable.upsert({
      where: { branchId_tableNumber: { branchId: branch.id, tableNumber } },
      update: {},
      create: { branchId: branch.id, tableNumber, capacity, floor, area },
    });
    if (!t.qrCode) await prisma.restaurantTable.update({ where: { id: t.id }, data: { qrCode: `${frontend}/order?branch=${branch.id}&table=${t.id}` } });
  }

  // ── inventory + recipes
  const inv: [string, string, string, number, number, number][] = [
    ['Paneer', 'Dairy', 'kg', 12, 5, 320],
    ['Chicken', 'Meat', 'kg', 20, 8, 220],
    ['Basmati Rice', 'Grains', 'kg', 40, 15, 110],
    ['Mango Pulp', 'Beverage', 'kg', 6, 3, 180],
    ['Limes', 'Produce', 'pcs', 150, 50, 4],
    ['Milk', 'Dairy', 'L', 25, 10, 60],
  ];
  const invIds: Record<string, string> = {};
  for (const [name, category, unit, stock, min, cost] of inv) {
    const row = await prisma.inventoryItem.upsert({
      where: { branchId_name: { branchId: branch.id, name } },
      update: {},
      create: { branchId: branch.id, name, category, unit, currentStock: stock, minStockLevel: min, costPerUnit: cost, lastRestockedAt: new Date() },
    });
    invIds[name] = row.id;
  }
  const recipes: [string, string, number][] = [
    ['Paneer Tikka', 'Paneer', 0.15], ['Paneer Butter Masala', 'Paneer', 0.2], ['Butter Chicken', 'Chicken', 0.25],
    ['Chicken Wings', 'Chicken', 0.3], ['Biryani', 'Basmati Rice', 0.2], ['Biryani', 'Chicken', 0.2],
    ['Mango Lassi', 'Mango Pulp', 0.1], ['Mango Lassi', 'Milk', 0.2], ['Fresh Lime Soda', 'Limes', 1],
  ];
  for (const [dish, ing, quantity] of recipes) {
    await prisma.recipeIngredient.upsert({
      where: { menuItemId_inventoryId: { menuItemId: items[dish], inventoryId: invIds[ing] } },
      update: {},
      create: { menuItemId: items[dish], inventoryId: invIds[ing], quantity },
    });
  }

  // ── print template defaults
  for (const type of ['kot', 'bill']) {
    await prisma.printTemplate.upsert({
      where: { branchId_type_name: { branchId: branch.id, type, name: 'default' } },
      update: {},
      create: { branchId: branch.id, type, name: 'default', config: { paperWidth: 42, showTax: true, footerLines: ['Thank you for dining with us!'] } },
    });
  }

  if ((process.env.SEED_DEMO_DATA ?? 'true') !== 'false') {
    console.log('Seeding demo data…');
    await seedDemoData(branch.id, restaurant.id);
  }

  // eslint-disable-next-line no-console
  console.log(`Seed complete.\n  Branch id : ${branch.id}\n  Admin     : ${ADMIN_EMAIL} / ${ADMIN_PASSWORD}\n  Staff     : manager@ / cashier@ / waiter@ / kitchen@harmonyhub.com (see prisma/seed.ts for passwords)`);
}

main()
  .catch((e) => {
    // eslint-disable-next-line no-console
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
