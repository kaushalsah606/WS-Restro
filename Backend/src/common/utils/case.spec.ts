import { Prisma } from '@prisma/client';
import { decimalsToNumbers, mapKeys, toCamel, toSnake } from './case';

describe('case utils', () => {
  it('converts keys both ways', () => {
    expect(toCamel('table_number')).toBe('tableNumber');
    expect(toSnake('tableNumber')).toBe('table_number');
    expect(toCamel('alreadyCamel')).toBe('alreadyCamel');
  });

  it('maps keys deeply but leaves Dates untouched', () => {
    const d = new Date();
    const out: any = mapKeys({ order_id: 1, items: [{ unit_price: 2 }], created_at: d }, toCamel);
    expect(out).toEqual({ orderId: 1, items: [{ unitPrice: 2 }], createdAt: d });
  });

  it('turns Decimals into numbers', () => {
    const out: any = decimalsToNumbers({ total: new Prisma.Decimal('12.50'), nested: [{ x: new Prisma.Decimal(3) }], when: new Date(0) });
    expect(out.total).toBe(12.5);
    expect(out.nested[0].x).toBe(3);
    expect(out.when).toEqual(new Date(0));
  });
});
