import { renderBill, renderKot } from './escpos';

describe('ESC/POS rendering', () => {
  it('KOT starts with init, ends with a cut and contains the items', () => {
    const buf = renderKot({ kotNumber: 'KOT-1', orderNumber: 'ORD-1', tableNumber: '5', items: [{ name: 'Biryani', quantity: 2, notes: 'no onion' }] });
    expect(buf.subarray(0, 2)).toEqual(Buffer.from([0x1b, 0x40]));
    expect(buf.includes(Buffer.from([0x1d, 0x56, 0x41, 0x03]))).toBe(true);
    const text = buf.toString('latin1');
    expect(text).toContain('2 x Biryani');
    expect(text).toContain('no onion');
  });

  it('bill replaces the rupee sign and prints the total', () => {
    const buf = renderBill({ billNumber: 'B-1', orderNumber: 'O-1', items: [{ name: 'Tea', quantity: 1, unitPrice: 10, total: 10 }], subtotal: 10, tax: 0.5, serviceCharge: 0.5, discount: 0, total: 11, payments: [{ method: 'cash', amount: 11 }] });
    expect(buf.toString('latin1')).toContain('Rs.11.00');
  });
});
