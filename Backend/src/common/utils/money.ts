import { Prisma } from '@prisma/client';

/** Convert Prisma Decimal | number | string | null into a JS number. */
export function num(v: Prisma.Decimal | number | string | null | undefined): number {
  if (v === null || v === undefined) return 0;
  return typeof v === 'number' ? v : Number(v.toString());
}

/** Round to 2 decimals (banker-safe enough for POS display currency). */
export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export interface Totals {
  subtotal: number;
  tax: number;
  serviceCharge: number;
  discount: number;
  total: number;
}

/**
 * tax and service charge are percentages of the (post-discount) subtotal,
 * matching the frontend which computes both on the item subtotal.
 */
export function computeTotals(subtotal: number, taxRatePct: number, serviceRatePct: number, discount = 0): Totals {
  const sub = round2(subtotal);
  const disc = Math.min(round2(discount), sub);
  const base = sub - disc;
  const tax = round2((base * taxRatePct) / 100);
  const serviceCharge = round2((base * serviceRatePct) / 100);
  return { subtotal: sub, tax, serviceCharge, discount: disc, total: round2(base + tax + serviceCharge) };
}
