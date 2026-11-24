import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Bill, Prisma } from '@prisma/client';
import { AccessService } from '../../common/access/access.service';
import { AuthUser } from '../../common/decorators';
import { pageArgs } from '../../common/dto/pagination.dto';
import { BILL_INCLUDE, BillWithRelations } from '../../common/includes';
import { paginated } from '../../common/interceptors/response.interceptor';
import { SequenceService } from '../../common/sequence/sequence.service';
import { parseDate, startOfDay } from '../../common/utils/dates';
import { computeTotals, num, round2 } from '../../common/utils/money';
import { EventBus } from '../../infra/events/event-bus.service';
import { EVENT } from '../../infra/events/event-types';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { OrdersService } from '../orders/orders.service';
import { TablesService } from '../tables/tables.module';
import {
  AddPaymentDto,
  BillQueryDto,
  CheckoutDto,
  DiscountDto,
  MergeBillDto,
  PartialBillDto,
  PaymentInputDto,
  PaymentQueryDto,
  SplitBillDto,
} from './dto/billing.dto';

type Tx = Prisma.TransactionClient;
const EPS = 0.009;

interface SettleResult {
  orderIds: string[];
  tableIds: string[];
}

@Injectable()
export class BillingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
    private readonly bus: EventBus,
    private readonly seq: SequenceService,
    private readonly orders: OrdersService,
    private readonly tables: TablesService,
  ) {}

  // ───────────────────────── reads ─────────────────────────

  present(b: BillWithRelations) {
    const paid = round2(b.payments.reduce((s, p) => s + num(p.amount), 0));
    return {
      ...b,
      orderNumber: b.order.orderNumber,
      tableNumber: b.order.table?.tableNumber ?? null,
      orderIds: b.orders.length ? b.orders.map((o) => o.orderId) : [b.orderId],
      amountPaid: paid,
      amountDue: Math.max(0, round2(num(b.total) - paid)),
    };
  }

  async snapshot(id: string) {
    const b = await this.prisma.bill.findUnique({ where: { id }, include: BILL_INCLUDE });
    if (!b) throw new NotFoundException('Bill not found');
    return this.present(b);
  }

  async get(user: AuthUser, id: string) {
    const b = await this.snapshot(id);
    await this.access.assertBranchAccess(user, b.branchId);
    return b;
  }

  async list(user: AuthUser, q: BillQueryDto) {
    const branchId = await this.access.resolveBranchId(user, q.branchId);
    const where: Prisma.BillWhereInput = { branchId };
    if (q.status) where.status = q.status;
    if (q.orderId) where.OR = [{ orderId: q.orderId }, { orders: { some: { orderId: q.orderId } } }];
    const from = parseDate(q.startDate);
    const to = parseDate(q.endDate);
    if (from || to) where.generatedAt = { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) };
    if (q.search) where.billNumber = { contains: q.search, mode: 'insensitive' };
    const { page, limit, skip, take } = pageArgs(q);
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.bill.findMany({ where, include: BILL_INCLUDE, orderBy: { generatedAt: 'desc' }, skip, take }),
      this.prisma.bill.count({ where }),
    ]);
    return paginated(rows.map((b) => this.present(b)), page, limit, total);
  }

  async listPayments(user: AuthUser, q: PaymentQueryDto) {
    const branchId = await this.access.resolveBranchId(user, q.branchId);
    const where: Prisma.PaymentWhereInput = { bill: { branchId } };
    if (q.method) where.method = q.method;
    const from = parseDate(q.startDate);
    const to = parseDate(q.endDate);
    if (from || to) where.createdAt = { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) };
    const { page, limit, skip, take } = pageArgs(q);
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.payment.findMany({
        where,
        include: { bill: { select: { id: true, billNumber: true, orderId: true } }, receivedBy: { select: { id: true, fullName: true } } },
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
      this.prisma.payment.count({ where }),
    ]);
    return paginated(rows, page, limit, total);
  }

  // ───────────────────────── generate ─────────────────────────

  private nextBillNumber(tx: Tx | PrismaService, branchId: string) {
    return this.seq.next('BILL', branchId, () => tx.bill.count({ where: { branchId, generatedAt: { gte: startOfDay() } } }));
  }

  /** Create (or refresh) the open bill for an order from its current totals. */
  async generate(user: AuthUser, orderId: string) {
    const order = await this.orders.get(user, orderId);
    if (order.status === 'cancelled') throw new ConflictException('Cannot bill a cancelled order');
    if (order.paidAt) throw new ConflictException('This order has already been paid');
    if (!order.items.some((i) => i.status !== 'cancelled' && !i.billedByBillId)) throw new BadRequestException('Order has no billable items');

    const open = await this.prisma.bill.findFirst({
      where: { orderId, status: { in: ['pending', 'partial'] }, kind: { in: ['full', 'split'] } },
      include: { payments: true },
    });

    if (open) {
      if (open.payments.length === 0) await this.syncBillWithOrder(open.id);
      return this.snapshot(open.id);
    }
    const billNumber = await this.nextBillNumber(this.prisma, order.branchId);
    const bill = await this.prisma.bill.create({
      data: {
        branchId: order.branchId,
        orderId,
        billNumber,
        subtotal: order.subtotal,
        tax: order.tax,
        serviceCharge: order.serviceCharge,
        discount: order.discount,
        total: order.total,
        status: 'pending',
        kind: 'full',
        generatedById: user.id,
        orders: { create: { orderId } },
      },
    });
    const snap = await this.snapshot(bill.id);
    await this.bus.publish(EVENT.BILL_CREATED, snap.branchId, snap, user.id);
    return snap;
  }

  private async syncBillWithOrder(billId: string) {
    const bill = await this.prisma.bill.findUniqueOrThrow({ where: { id: billId } });
    const o = await this.prisma.order.findUniqueOrThrow({ where: { id: bill.orderId } });
    await this.prisma.bill.update({
      where: { id: billId },
      data: { subtotal: o.subtotal, tax: o.tax, serviceCharge: o.serviceCharge, discount: o.discount, total: o.total },
    });
  }

  // ───────────────────────── discount ─────────────────────────

  async applyDiscount(user: AuthUser, billId: string, dto: DiscountDto) {
    const bill = await this.get(user, billId);
    if (bill.status === 'completed' || bill.status === 'refunded') throw new ConflictException('Bill is already settled');
    if (bill.kind !== 'full' && bill.kind !== 'split') throw new ConflictException('Discounts can only be applied to full bills');

    const base = num(bill.subtotal) + num(bill.discount); // undiscounted subtotal
    const amount = dto.type === 'percent' ? round2((base * dto.discount) / 100) : round2(dto.discount);
    if (amount > base) throw new BadRequestException('Discount exceeds the bill subtotal');

    const s = await this.access.getBranchSettings(bill.branchId);
    const t = computeTotals(base, s.taxRate, s.serviceChargeRate, amount);
    if (t.total + EPS < bill.amountPaid) throw new BadRequestException('Discount would make the bill less than the amount already paid');

    await this.prisma.$transaction(async (tx) => {
      await tx.order.update({ where: { id: bill.orderId }, data: { discount: t.discount } });
      await this.orders.recalc(tx, bill.orderId);
      await tx.bill.update({
        where: { id: billId },
        data: { subtotal: t.subtotal, tax: t.tax, serviceCharge: t.serviceCharge, discount: t.discount, total: t.total },
      });
    });
    return this.afterBillChange(billId, user.id);
  }

  // ───────────────────────── payments ─────────────────────────

  private normalizePayments(dto: { method?: any; amount?: number; reference?: string; payments?: PaymentInputDto[] }): PaymentInputDto[] {
    if (dto.payments?.length) return dto.payments;
    if (dto.method && dto.amount) return [{ method: dto.method, amount: dto.amount, reference: dto.reference }];
    throw new BadRequestException('Provide either method + amount or a payments array');
  }

  async addPayment(user: AuthUser, billId: string, dto: AddPaymentDto) {
    const existing = await this.get(user, billId);
    if (existing.status === 'completed' || existing.status === 'refunded') throw new ConflictException(`Bill is already ${existing.status}`);
    const inputs = this.normalizePayments(dto);
    const { settled, change } = await this.prisma.$transaction(async (tx) => this.applyPayments(tx, billId, inputs, user.id));
    const bill = await this.afterBillChange(billId, user.id, settled);
    return { ...bill, change };
  }

  /**
   * Record payments against a bill inside a transaction. Locks the bill row so two cashiers
   * can't both complete it. Cash overpayment is returned as `change`.
   */
  private async applyPayments(tx: Tx, billId: string, inputs: PaymentInputDto[], userId: string) {
    await tx.$queryRaw`SELECT id FROM bills WHERE id = ${billId} FOR UPDATE`;
    const bill = await tx.bill.findUniqueOrThrow({ where: { id: billId }, include: { payments: true } });
    if (bill.status === 'completed' || bill.status === 'refunded') throw new ConflictException(`Bill is already ${bill.status}`);

    let due = round2(num(bill.total) - bill.payments.reduce((s, p) => s + num(p.amount), 0));
    let change = 0;
    for (const p of inputs) {
      if (due <= EPS) throw new ConflictException('Bill is already fully paid');
      let amount = round2(p.amount);
      if (amount > due + EPS) {
        if (p.method !== 'cash') throw new BadRequestException(`${p.method} payment exceeds the amount due (${due})`);
        change = round2(amount - due);
        amount = due;
      }
      await tx.payment.create({ data: { billId, method: p.method, amount, reference: p.reference, receivedById: userId } });
      due = round2(due - amount);
    }
    if (due <= EPS) {
      await tx.bill.update({ where: { id: billId }, data: { status: 'completed', paidAt: new Date() } });
      return { settled: await this.settleOrders(tx, billId), change };
    }
    await tx.bill.update({ where: { id: billId }, data: { status: 'partial' } });
    return { settled: null as SettleResult | null, change };
  }

  /** Mark the bill's order(s) paid + served and release their tables. */
  private async settleOrders(tx: Tx, billId: string): Promise<SettleResult> {
    const bill = await tx.bill.findUniqueOrThrow({ where: { id: billId }, include: { orders: true } });
    // partial bills only settle their order when nothing billable remains (handled by caller)
    if (bill.kind === 'partial') return { orderIds: [], tableIds: [] };
    const orderIds = bill.orders.length ? bill.orders.map((o) => o.orderId) : [bill.orderId];
    return this.closeOrders(tx, orderIds);
  }

  private async closeOrders(tx: Tx, orderIds: string[]): Promise<SettleResult> {
    const tableIds: string[] = [];
    const now = new Date();
    for (const id of orderIds) {
      const o = await tx.order.findUniqueOrThrow({ where: { id } });
      await tx.orderItem.updateMany({ where: { orderId: id, status: { notIn: ['cancelled', 'served'] } }, data: { status: 'served' } });
      await tx.kot.updateMany({ where: { orderId: id, status: { in: ['printed', 'acknowledged'] } }, data: { status: 'completed' } });
      await tx.order.update({ where: { id }, data: { paidAt: now, status: 'served', servedAt: o.servedAt ?? now } });
      if (o.tableId) {
        await this.orders.releaseTable(tx, o.tableId, id, 'cleaning');
        tableIds.push(o.tableId);
      }
    }
    return { orderIds, tableIds };
  }

  private async afterBillChange(billId: string, actorId: string, settled?: SettleResult | null) {
    const bill = await this.snapshot(billId);
    await this.bus.publish(bill.status === 'completed' ? EVENT.BILL_PAID : EVENT.BILL_UPDATED, bill.branchId, bill, actorId);
    if (settled) await this.publishSettlement(settled, actorId);
    return bill;
  }

  private async publishSettlement(s: SettleResult, actorId: string) {
    for (const id of s.orderIds) {
      const order = await this.orders.snapshot(id);
      await this.bus.publish(EVENT.ORDER_STATUS_CHANGED, order.branchId, { order, status: 'served', previousStatus: 'ready' }, actorId);
    }
    for (const id of new Set(s.tableIds)) await this.tables.publishChange(id, 'occupied', actorId);
  }

  // ───────────────────────── one-shot flows ─────────────────────────

  /** Generate + discount + pay in one request (what the cashier "Pay" button does). */
  async checkout(user: AuthUser, orderId: string, dto: CheckoutDto) {
    const bill = await this.generate(user, orderId);
    if (dto.discount && dto.discount > 0) await this.applyDiscount(user, bill.id, { discount: dto.discount, type: dto.discountType });
    return this.addPayment(user, bill.id, { payments: dto.payments });
  }

  /** Split by person: every split is a payment on one shared bill. */
  async split(user: AuthUser, orderId: string, dto: SplitBillDto) {
    const bill = await this.generate(user, orderId);
    await this.prisma.bill.update({ where: { id: bill.id }, data: { kind: 'split' } });
    const payments = dto.splits.map((s) => ({ method: s.method, amount: s.amount, reference: s.reference ?? s.label }));
    return this.addPayment(user, bill.id, { payments });
  }

  /** Bill and pay only some items of an order. */
  async partial(user: AuthUser, dto: PartialBillDto) {
    const inputs = dto.payments?.length ? dto.payments : dto.method ? [{ method: dto.method, amount: -1, reference: dto.reference ?? 'Partial bill' }] : null;
    if (!inputs) throw new BadRequestException('A payment method is required');

    const order = await this.orders.get(user, dto.orderId);
    if (order.paidAt || order.status === 'cancelled') throw new ConflictException('This order is not open for billing');
    const s = await this.access.getBranchSettings(order.branchId);

    let subtotal = 0;
    const picks = dto.items.map((sel) => {
      const item = order.items.find((i) => i.id === sel.itemId && i.status !== 'cancelled' && !i.billedByBillId);
      if (!item) throw new NotFoundException('Selected item not found on this order');
      if (sel.quantity > item.quantity) throw new BadRequestException(`Only ${item.quantity} × ${item.name} on the order`);
      subtotal += num(item.unitPrice) * sel.quantity;
      return { item, qty: sel.quantity };
    });
    const t = computeTotals(subtotal, s.taxRate, s.serviceChargeRate, 0);
    const billNumber = await this.nextBillNumber(this.prisma, order.branchId);

    const { billId, settled } = await this.prisma.$transaction(async (tx) => {
      const bill = await tx.bill.create({
        data: {
          branchId: order.branchId,
          orderId: order.id,
          billNumber,
          subtotal: t.subtotal,
          tax: t.tax,
          serviceCharge: t.serviceCharge,
          discount: 0,
          total: t.total,
          status: 'pending',
          kind: 'partial',
          generatedById: user.id,
          notes: picks.map((p) => `${p.qty}× ${p.item.name}`).join(', '),
          orders: { create: { orderId: order.id } },
        },
      });
      // mark what was just billed; unbilled quantity stays on the open order
      for (const { item, qty } of picks) {
        if (qty === item.quantity) {
          await tx.orderItem.update({ where: { id: item.id }, data: { billedByBillId: bill.id, status: 'served' } });
        } else {
          await tx.orderItem.update({ where: { id: item.id }, data: { quantity: item.quantity - qty, total: round2(num(item.unitPrice) * (item.quantity - qty)) } });
          const { id: _id, orderId: _oid, createdAt: _c, updatedAt: _u, ...copy } = item;
          await tx.orderItem.create({ data: { ...copy, addons: (copy.addons ?? undefined) as Prisma.InputJsonValue | undefined, orderId: order.id, quantity: qty, total: round2(num(item.unitPrice) * qty), status: 'served', billedByBillId: bill.id } });
        }
      }
      await this.orders.recalc(tx, order.id);
      const remaining = await tx.orderItem.count({ where: { orderId: order.id, status: { not: 'cancelled' }, billedByBillId: null } });

      // normalise the "pay the whole bill" shortcut (amount -1)
      const payInputs = inputs.map((p) => ({ ...p, amount: p.amount > 0 ? p.amount : t.total }));
      const res = await this.applyPayments(tx, bill.id, payInputs, user.id);
      let settledOrders: SettleResult | null = null;
      if (res.settled !== null && remaining === 0) settledOrders = await this.closeOrders(tx, [order.id]);
      return { billId: bill.id, settled: settledOrders };
    });

    const snap = await this.snapshot(billId);
    await this.bus.publish(EVENT.BILL_CREATED, snap.branchId, snap, user.id);
    const fresh = await this.afterBillChange(billId, user.id, settled);
    if (!settled) {
      const o = await this.orders.snapshot(order.id);
      await this.bus.publish(EVENT.ORDER_UPDATED, o.branchId, o, user.id);
    }
    return fresh;
  }

  /** One bill for several orders (e.g. friends seated at different tables). */
  async merge(user: AuthUser, dto: MergeBillDto) {
    const ids = [...new Set(dto.orderIds)];
    if (ids.length < 2) throw new BadRequestException('Select at least two orders to merge');
    const orders = await Promise.all(ids.map((id) => this.orders.get(user, id)));
    if (new Set(orders.map((o) => o.branchId)).size !== 1) throw new BadRequestException('Orders belong to different branches');
    const bad = orders.find((o) => o.paidAt || o.status === 'cancelled');
    if (bad) throw new ConflictException(`Order ${bad.orderNumber} is not open for billing`);

    const branchId = orders[0].branchId;
    const s = await this.access.getBranchSettings(branchId);
    const subtotal = orders.reduce((sum, o) => sum + num(o.subtotal) + num(o.discount), 0);
    const existingDiscount = orders.reduce((sum, o) => sum + num(o.discount), 0);
    const t = computeTotals(subtotal, s.taxRate, s.serviceChargeRate, dto.discount ?? existingDiscount);

    const inputs = dto.payments?.length ? dto.payments : dto.method ? [{ method: dto.method, amount: t.total, reference: dto.reference ?? `Merged bill for orders: ${orders.map((o) => o.orderNumber).join(', ')}` }] : null;
    if (!inputs) throw new BadRequestException('A payment method is required');

    const billNumber = await this.nextBillNumber(this.prisma, branchId);
    const { billId, settled } = await this.prisma.$transaction(async (tx) => {
      const bill = await tx.bill.create({
        data: {
          branchId,
          orderId: orders[0].id,
          billNumber,
          subtotal: t.subtotal,
          tax: t.tax,
          serviceCharge: t.serviceCharge,
          discount: t.discount,
          total: t.total,
          status: 'pending',
          kind: 'merged',
          generatedById: user.id,
          orders: { create: orders.map((o) => ({ orderId: o.id })) },
        },
      });
      const res = await this.applyPayments(tx, bill.id, inputs, user.id);
      return { billId: bill.id, settled: res.settled };
    });
    const snap = await this.snapshot(billId);
    await this.bus.publish(EVENT.BILL_CREATED, snap.branchId, snap, user.id);
    return this.afterBillChange(billId, user.id, settled);
  }

  async refund(user: AuthUser, billId: string, reason?: string) {
    const bill = await this.get(user, billId);
    if (bill.status !== 'completed') throw new ConflictException('Only completed bills can be refunded');
    await this.prisma.bill.update({ where: { id: billId }, data: { status: 'refunded', notes: [bill.notes, reason ? `Refund: ${reason}` : 'Refunded'].filter(Boolean).join(' | ') } });
    return this.afterBillChange(billId, user.id);
  }

  async cancelOpenBill(user: AuthUser, billId: string): Promise<Bill> {
    const bill = await this.get(user, billId);
    if (bill.amountPaid > 0 || bill.status === 'completed') throw new ConflictException('Bills with payments cannot be removed');
    return this.prisma.bill.delete({ where: { id: billId } });
  }
}
