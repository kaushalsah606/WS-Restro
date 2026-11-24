import { computeTotals, round2 } from './money';

describe('money', () => {
  it('rounds to 2 decimals', () => {
    expect(round2(1.005)).toBe(1.01);
    expect(round2(10.239)).toBe(10.24);
  });

  it('computes tax and service charge on the subtotal', () => {
    expect(computeTotals(880, 5, 5)).toEqual({ subtotal: 880, tax: 44, serviceCharge: 44, discount: 0, total: 968 });
  });

  it('applies discount before tax and service charge', () => {
    // 380 - 10% = 342 ; 5% of 342 = 17.1 each
    const t = computeTotals(380, 5, 5, 38);
    expect(t.total).toBe(376.2);
    expect(t.tax).toBe(17.1);
  });

  it('never lets the discount exceed the subtotal', () => {
    expect(computeTotals(100, 5, 5, 500)).toMatchObject({ discount: 100, total: 0 });
  });
});
