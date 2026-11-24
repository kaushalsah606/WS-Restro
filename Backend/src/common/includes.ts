import { Prisma } from '@prisma/client';

/** Shared Prisma includes so every producer emits identically-shaped snapshots. */
export const ORDER_INCLUDE = {
  items: { orderBy: { createdAt: 'asc' as const } },
  table: { select: { id: true, tableNumber: true, floor: true, area: true } },
  waiter: { select: { id: true, fullName: true } },
} satisfies Prisma.OrderInclude;

export type OrderWithRelations = Prisma.OrderGetPayload<{ include: typeof ORDER_INCLUDE }>;

export const KOT_INCLUDE = {
  items: true,
  order: {
    select: {
      id: true,
      orderNumber: true,
      orderType: true,
      notes: true,
      table: { select: { id: true, tableNumber: true } },
      waiter: { select: { id: true, fullName: true } },
    },
  },
} satisfies Prisma.KotInclude;

export type KotWithRelations = Prisma.KotGetPayload<{ include: typeof KOT_INCLUDE }>;

export const BILL_INCLUDE = {
  payments: { orderBy: { createdAt: 'asc' as const } },
  order: {
    select: {
      id: true,
      orderNumber: true,
      tableId: true,
      table: { select: { id: true, tableNumber: true } },
    },
  },
  orders: { select: { orderId: true } },
} satisfies Prisma.BillInclude;

export type BillWithRelations = Prisma.BillGetPayload<{ include: typeof BILL_INCLUDE }>;

export const MENU_ITEM_INCLUDE = {
  variants: true,
  addons: true,
  category: { select: { id: true, name: true } },
} satisfies Prisma.MenuItemInclude;
