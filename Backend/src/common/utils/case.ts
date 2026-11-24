import { Prisma } from '@prisma/client';

export function toCamel(key: string): string {
  return key.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());
}

export function toSnake(key: string): string {
  return key.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && Object.getPrototypeOf(v) === Object.prototype;
}

/** Deep-map object keys. Dates, Decimals, Buffers, etc. are left untouched. */
export function mapKeys(value: unknown, fn: (k: string) => string): unknown {
  if (Array.isArray(value)) return value.map((v) => mapKeys(v, fn));
  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[fn(k)] = mapKeys(v, fn);
    return out;
  }
  return value;
}

/** Deep convert Prisma Decimals to numbers so JSON consumers get real numbers. */
export function decimalsToNumbers(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (Prisma.Decimal.isDecimal(value)) return Number((value as Prisma.Decimal).toString());
  if (value instanceof Date) return value;
  if (Array.isArray(value)) return value.map(decimalsToNumbers);
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = decimalsToNumbers(v);
    return out;
  }
  return value;
}
