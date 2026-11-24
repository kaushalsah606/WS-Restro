/**
 * Minimal ESC/POS document builder (mirrors the command set used by the frontend's printerService).
 * Produces a Buffer ready to be written to a raw 9100 socket or handed to a local print agent.
 */
const ESC = 0x1b;
const GS = 0x1d;

export class EscPos {
  private chunks: Buffer[] = [];

  constructor(public readonly width = 42) {}

  private raw(...bytes: number[]) {
    this.chunks.push(Buffer.from(bytes));
    return this;
  }

  init() { return this.raw(ESC, 0x40); }
  align(a: 'left' | 'center' | 'right') { return this.raw(ESC, 0x61, { left: 0, center: 1, right: 2 }[a]); }
  bold(on: boolean) { return this.raw(ESC, 0x45, on ? 1 : 0); }
  size(s: 'normal' | 'tall' | 'wide' | 'double') { return this.raw(ESC, 0x21, { normal: 0x00, tall: 0x10, wide: 0x20, double: 0x30 }[s]); }
  feed(n = 1) { return this.raw(ESC, 0x64, n); }
  cut() { return this.raw(GS, 0x56, 0x41, 0x03); }
  openDrawer() { return this.raw(ESC, 0x70, 0x00, 0x19, 0xfa); }

  text(s: string) {
    // CP437-safe-ish: replace characters most thermal printers can't render
    const clean = s.replace(/₹/g, 'Rs.').replace(/[^\x20-\x7e\n]/g, '?');
    this.chunks.push(Buffer.from(clean, 'latin1'));
    return this;
  }
  line(s = '') { return this.text(s + '\n'); }
  rule(ch = '-') { return this.line(ch.repeat(this.width)); }

  /** left text + right-aligned text on one line */
  row(left: string, right: string) {
    const space = this.width - right.length;
    const l = left.length > space - 1 ? left.slice(0, Math.max(0, space - 1)) : left;
    return this.line(l.padEnd(space) + right);
  }

  /** word-wrap long text to the paper width with optional indent */
  wrap(s: string, indent = 0) {
    const w = this.width - indent;
    const words = s.split(/\s+/);
    let cur = '';
    for (const word of words) {
      if ((cur + ' ' + word).trim().length > w) {
        this.line(' '.repeat(indent) + cur.trim());
        cur = word;
      } else cur = (cur + ' ' + word).trim();
    }
    if (cur) this.line(' '.repeat(indent) + cur);
    return this;
  }

  qr(data: string) {
    const bytes = Buffer.from(data, 'latin1');
    const len = bytes.length + 3;
    this.raw(GS, 0x28, 0x6b, 0x04, 0x00, 0x31, 0x41, 0x32, 0x00); // model 2
    this.raw(GS, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x43, 0x06); // size 6
    this.raw(GS, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x45, 0x31); // error correction M
    this.raw(GS, 0x28, 0x6b, len & 0xff, (len >> 8) & 0xff, 0x31, 0x50, 0x30);
    this.chunks.push(bytes);
    this.raw(GS, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x51, 0x30); // print
    return this;
  }

  build(): Buffer {
    return Buffer.concat(this.chunks);
  }
}

export interface PrintTemplateConfig {
  paperWidth?: number; // characters per line (42 = 80mm, 32 = 58mm)
  headerLines?: string[];
  footerLines?: string[];
  showTax?: boolean;
  showQr?: boolean;
  openDrawer?: boolean;
}

const money = (n: number) => `Rs.${Number(n).toFixed(2)}`;
const dateStr = (d?: string | Date) => new Date(d ?? Date.now()).toLocaleString('en-GB', { hour12: false });

export function renderKot(p: any, cfg: PrintTemplateConfig = {}): Buffer {
  const d = new EscPos(cfg.paperWidth ?? 42).init();
  d.align('center').bold(true).size('double').line(p.isReprint ? 'KOT (REPRINT)' : 'KITCHEN ORDER').size('normal').bold(false);
  d.align('left').rule('=');
  d.bold(true).row(`KOT: ${p.kotNumber ?? ''}`, p.tableNumber ? `Table ${p.tableNumber}` : String(p.orderType ?? '').replace('_', ' ')).bold(false);
  d.row(`Order: ${p.orderNumber ?? ''}`, dateStr(p.createdAt).slice(-8));
  if (p.waiterName) d.line(`Waiter: ${p.waiterName}`);
  d.rule();
  for (const it of p.items ?? []) {
    d.bold(true).size('tall').line(`${it.quantity} x ${it.name}`).size('normal').bold(false);
    if (it.variant) d.line(`   (${it.variant})`);
    if (it.addons?.length) d.line(`   + ${it.addons.map((a: any) => a.name).join(', ')}`);
    if (it.course) d.line(`   Course: ${it.course}`);
    if (it.notes) d.bold(true).wrap(`** ${it.notes}`, 3).bold(false);
  }
  if (p.notes) d.rule().bold(true).wrap(`NOTE: ${p.notes}`).bold(false);
  d.rule('=').feed(3).cut();
  return d.build();
}

export function renderBill(p: any, cfg: PrintTemplateConfig = {}): Buffer {
  const d = new EscPos(cfg.paperWidth ?? 42).init();
  d.align('center').bold(true).size('wide').line(p.restaurant?.name ?? 'Restaurant').size('normal').bold(false);
  if (p.restaurant?.address) d.wrap(p.restaurant.address);
  if (p.restaurant?.phone) d.line(`Tel: ${p.restaurant.phone}`);
  for (const h of cfg.headerLines ?? []) d.line(h);
  d.rule().bold(true).line('TAX INVOICE').bold(false).align('left').rule();
  d.row('Bill No:', p.billNumber ?? '');
  d.row('Order:', p.orderNumber ?? '');
  if (p.tableNumber) d.row('Table:', String(p.tableNumber));
  d.row('Date:', dateStr(p.paidAt ?? p.generatedAt));
  d.rule();
  d.row('Item', 'Amount');
  d.rule();
  for (const it of p.items ?? []) {
    d.row(`${it.quantity} x ${it.name}`, money(it.total));
    if (it.quantity > 1) d.line(`   @ ${money(it.unitPrice)}`);
  }
  d.rule();
  d.row('Subtotal', money(p.subtotal));
  if (p.discount > 0) d.row('Discount', `-${money(p.discount)}`);
  if (cfg.showTax !== false) {
    d.row('Tax', money(p.tax));
    d.row('Service charge', money(p.serviceCharge));
  }
  d.rule().bold(true).size('tall').row('TOTAL', money(p.total)).size('normal').bold(false).rule();
  for (const pay of p.payments ?? []) d.row(`Paid (${pay.method})`, money(pay.amount));
  d.align('center').feed(1);
  for (const f of cfg.footerLines?.length ? cfg.footerLines : ['Thank you for dining with us!', 'Please visit again']) d.line(f);
  if (cfg.showQr && p.feedbackUrl) d.feed(1).qr(p.feedbackUrl);
  d.feed(3).cut();
  if (cfg.openDrawer && (p.payments ?? []).some((x: any) => x.method === 'cash')) d.openDrawer();
  return d.build();
}

export function renderTest(printerName: string): Buffer {
  return new EscPos(42)
    .init()
    .align('center').bold(true).size('double').line('PRINTER TEST').size('normal').bold(false)
    .line(printerName)
    .line(dateStr())
    .rule()
    .line('If you can read this,')
    .line('the printer is configured correctly.')
    .feed(3)
    .cut()
    .build();
}

export function renderReport(p: any, cfg: PrintTemplateConfig = {}): Buffer {
  const d = new EscPos(cfg.paperWidth ?? 42).init();
  d.align('center').bold(true).line(p.title ?? 'REPORT').bold(false).line(dateStr()).align('left').rule();
  for (const r of p.rows ?? []) d.row(String(r.label), String(r.value));
  d.feed(3).cut();
  return d.build();
}

export function renderDrawer(): Buffer {
  return new EscPos(42).init().openDrawer().build();
}
