import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { OrderStatus, Prisma } from '@prisma/client';
import { AccessService } from '../../common/access/access.service';
import { AuthUser } from '../../common/decorators';
import { pageArgs } from '../../common/dto/pagination.dto';
import { KOT_INCLUDE, ORDER_INCLUDE, OrderWithRelations } from '../../common/includes';
import { paginated } from '../../common/interceptors/response.interceptor';
import { SequenceService } from '../../common/sequence/sequence.service';
import { parseDate, startOfDay } from '../../common/utils/dates';
import { computeTotals, num, round2 } from '../../common/utils/money';
import { EventBus } from '../../infra/events/event-bus.service';
import { EVENT } from '../../infra/events/event-types';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { TablesService } from '../tables/tables.module';
import {
  AddItemsDto,
  CreateOrderDto,
  KotQueryDto,
  OrderItemInputDto,
  OrderQueryDto,
  SplitTableDto,
  UpdateOrderDto,
  UpdateOrderItemDto,
} from './dto/orders.dto';

type Tx = Prisma.TransactionClient;

export const ACTIVE_STATUSES: OrderStatus[] = ['pending', 'preparing', 'ready'];

const TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  pending: ['preparing', 'ready', 'cancelled'],
  preparing: ['pending', 'ready', 'cancelled'],
  ready: ['preparing', 'served', 'cancelled'],
  served: [],
  cancelled: [],
};

export function presentOrder(o: OrderWithRelations) {
  return {
    ...o,
    totalAmount: o.total, // alias used by some dashboard hooks
    tableNumber: o.table?.tableNumber ?? null,
    waiterName: o.waiter?.fullName ?? null,
    isPaid: !!o.paidAt,
  };
}

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
    private readonly bus: EventBus,
    private readonly seq: SequenceService,
    private readonly tables: TablesService,
  ) {}

  // ───────────────────────── reads ─────────────────────────

  async snapshot(id: string) {
    const o = await this.prisma.order.findUnique({ where: { id }, include: ORDER_INCLUDE });
    if (!o) throw new NotFoundException('Order not found');
    return presentOrder(o);
  }

  async get(user: AuthUser, id: string) {
    const o = await this.snapshot(id);
    await this.access.assertBranchAccess(user, o.branchId);
    return o;
  }

  async list(user: AuthUser, q: OrderQueryDto) {
    const branchId = await this.access.resolveBranchId(user, q.branchId);
    const where: Prisma.OrderWhereInput = { branchId };
    if (q.status) where.status = { in: q.status.split(',').map((s) => s.trim()) as OrderStatus[] };
    if (q.tableId) where.tableId = q.tableId;
    if (q.waiterId) where.waiterId = q.waiterId;
    if (q.orderType) where.orderType = q.orderType;
    if (q.unpaid) {
      where.paidAt = null;
      where.status = where.status ?? { not: 'cancelled' };
    }
    const from = parseDate(q.startDate);
    const to = parseDate(q.endDate);
    if (from || to) where.createdAt = { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) };
    if (q.search) {
      where.OR = [
        { orderNumber: { contains: q.search, mode: 'insensitive' } },
        { customerName: { contains: q.search, mode: 'insensitive' } },
        { customerPhone: { contains: q.search } },
        { table: { tableNumber: { contains: q.search, mode: 'insensitive' } } },
      ];
    }
    const { page, limit, skip, take } = pageArgs(q);
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.order.findMany({ where, include: ORDER_INCLUDE, orderBy: { createdAt: 'desc' }, skip, take }),
      this.prisma.order.count({ where }),
    ]);
    return paginated(rows.map(presentOrder), page, limit, total);
  }

  /** Flat order-item rows for reporting screens. */
  async itemsReport(user: AuthUser, q: { branchId?: string; startDate?: string; endDate?: string }) {
    const branchId = await this.access.resolveBranchId(user, q.branchId);
    const from = parseDate(q.startDate);
    const to = parseDate(q.endDate);
    return this.prisma.orderItem.findMany({
      where: {
        status: { not: 'cancelled' },
        order: { branchId, status: { not: 'cancelled' }, ...(from || to ? { createdAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}) },
      },
      include: {
        menuItem: { select: { id: true, name: true, categoryId: true, category: { select: { name: true } } } },
        order: { select: { id: true, orderNumber: true, createdAt: true, waiterId: true, orderType: true, status: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 10_000,
    });
  }

  // ───────────────────────── pricing helpers ─────────────────────────

  private async buildItems(branchId: string, inputs: OrderItemInputDto[]) {
    const ids = [...new Set(inputs.map((i) => i.menuItemId))];
    const menu = await this.prisma.menuItem.findMany({ where: { id: { in: ids }, branchId }, include: { variants: true, addons: true } });
    const byId = new Map(menu.map((m) => [m.id, m]));

    return inputs.map((input) => {
      const m = byId.get(input.menuItemId);
      if (!m) throw new BadRequestException('A menu item in the order does not exist in this branch');
      if (!m.isAvailable) throw new ConflictException(`"${m.name}" is currently unavailable`);

      let unit = num(m.price);
      let variantName: string | null = null;
      if (input.variantId) {
        const v = m.variants.find((x) => x.id === input.variantId);
        if (!v) throw new BadRequestException(`Invalid variant for "${m.name}"`);
        unit += num(v.priceModifier);
        variantName = v.name;
      }
      const addons = (input.addonIds ?? []).map((aid) => {
        const a = m.addons.find((x) => x.id === aid);
        if (!a) throw new BadRequestException(`Invalid add-on for "${m.name}"`);
        unit += num(a.price);
        return { id: a.id, name: a.name, price: num(a.price) };
      });
      unit = round2(unit);
      return {
        menuItemId: m.id,
        name: m.name,
        quantity: input.quantity,
        unitPrice: unit,
        total: round2(unit * input.quantity),
        notes: input.notes ?? null,
        variantName,
        addons: addons.length ? (addons as unknown as Prisma.InputJsonValue) : undefined,
        course: input.course ?? null,
      };
    });
  }

  /** Recompute subtotal/tax/service/total from live (non-cancelled) items. */
  async recalc(tx: Tx, orderId: string) {
    const order = await tx.order.findUniqueOrThrow({ where: { id: orderId }, select: { branchId: true, discount: true } });
    const agg = await tx.orderItem.aggregate({ where: { orderId, status: { not: 'cancelled' }, billedByBillId: null }, _sum: { total: true } });
    const s = await this.access.getBranchSettings(order.branchId);
    const t = computeTotals(num(agg._sum.total), s.taxRate, s.serviceChargeRate, num(order.discount));
    return tx.order.update({
      where: { id: orderId },
      data: { subtotal: t.subtotal, tax: t.tax, serviceCharge: t.serviceCharge, discount: t.discount, total: t.total },
    });
  }

  // ───────────────────────── KOT ─────────────────────────

  /** Group not-yet-sent items into a Kitchen Order Ticket. */
  private async createKot(tx: Tx, orderId: string, branchId: string, itemIds?: string[]) {
    const items = await tx.orderItem.findMany({
      where: { orderId, kotId: null, status: { not: 'cancelled' }, ...(itemIds ? { id: { in: itemIds } } : {}) },
      select: { id: true },
    });
    if (!items.length) return null;
    const kotNumber = await this.seq.next('KOT', branchId, () => tx.kot.count({ where: { branchId, createdAt: { gte: startOfDay() } } }));
    const kot = await tx.kot.create({ data: { branchId, orderId, kotNumber, status: 'printed' } });
    await tx.orderItem.updateMany({ where: { id: { in: items.map((i) => i.id) } }, data: { kotId: kot.id, kotPrinted: true } });
    return kot;
  }

  private async publishKot(kotId: string, actorId?: string, isReprint = false) {
    const kot = await this.prisma.kot.findUniqueOrThrow({ where: { id: kotId }, include: KOT_INCLUDE });
    await this.bus.publish(EVENT.KOT_CREATED, kot.branchId, { ...kot, isReprint }, actorId);
    return kot;
  }

  async reprintKot(user: AuthUser, orderId: string, kotId?: string) {
    const order = await this.get(user, orderId);
    const kot = await this.prisma.kot.findFirst({ where: { orderId, ...(kotId ? { id: kotId } : {}) }, orderBy: { createdAt: 'desc' } });
    if (!kot) throw new NotFoundException('No KOT exists for this order yet');
    await this.prisma.kot.update({ where: { id: kot.id }, data: { isReprint: true } });
    await this.publishKot(kot.id, user.id, true);
    return { orderId: order.id, kotId: kot.id, reprinted: true };
  }

  // ───────────────────────── create / add ─────────────────────────

  private async nextOrderNumber(branchId: string, prefix: string) {
    return this.seq.next(prefix, branchId, () => this.prisma.order.count({ where: { branchId, createdAt: { gte: startOfDay() } } }));
  }

  /**
   * Create an order. If the table already has an open order, the new items are appended to it
   * (one running bill per table) instead of opening a second order.
   * `user` is undefined for anonymous QR-menu customers.
   */
  async create(user: AuthUser | undefined, dto: CreateOrderDto, opts: { customerSessionId?: string } = {}) {
    const branchId = await this.access.resolveBranchId(user, dto.branchId);
    const isCustomer = !user;
    const orderType = isCustomer ? 'dine_in' : (dto.orderType ?? (dto.tableId ? 'dine_in' : 'takeaway'));
    if (isCustomer && !dto.tableId) throw new BadRequestException('A table is required for QR orders');
    if (orderType === 'dine_in' && !dto.tableId) throw new BadRequestException('A table is required for dine-in orders');

    const built = await this.buildItems(branchId, dto.items);

    const result = await this.prisma.$transaction(async (tx) => {
      let tableId: string | null = null;
      let existingOrderId: string | null = null;
      let previousTableStatus: any;

      if (dto.tableId) {
        // serialize concurrent orders for the same table
        await tx.$queryRaw`SELECT id FROM restaurant_tables WHERE id = ${dto.tableId} FOR UPDATE`;
        let table = await tx.restaurantTable.findFirst({ where: { id: dto.tableId, branchId, isActive: true } });
        if (!table) throw new NotFoundException('Table not found');
        if (table.mergedIntoId) table = await tx.restaurantTable.findUniqueOrThrow({ where: { id: table.mergedIntoId } });
        if (table.status === 'cleaning' && isCustomer) throw new ConflictException('This table is being cleaned. Please ask a staff member.');
        tableId = table.id;
        previousTableStatus = table.status;
        if (table.currentOrderId) {
          const open = await tx.order.findFirst({ where: { id: table.currentOrderId, status: { in: ACTIVE_STATUSES }, paidAt: null }, select: { id: true } });
          existingOrderId = open?.id ?? null;
        }
      }

      let orderId: string;
      let created = false;
      if (existingOrderId) {
        orderId = existingOrderId;
        await tx.orderItem.createMany({ data: built.map((b) => ({ ...b, orderId })) });
        // new food on a ready order sends it back to the kitchen
        await tx.order.update({ where: { id: orderId }, data: { status: 'preparing', ...(dto.notes ? { notes: dto.notes } : {}) } });
      } else {
        created = true;
        const orderNumber = await this.nextOrderNumber(branchId, isCustomer ? 'QR' : 'ORD');
        const order = await tx.order.create({
          data: {
            branchId,
            tableId,
            waiterId: user?.id ?? null,
            customerSessionId: opts.customerSessionId,
            customerName: dto.customerName,
            customerPhone: dto.customerPhone,
            orderNumber,
            orderType,
            notes: dto.notes,
            discount: isCustomer ? 0 : (dto.discount ?? 0),
            items: { create: built },
          },
        });
        orderId = order.id;
        if (tableId) await tx.restaurantTable.update({ where: { id: tableId }, data: { status: 'occupied', currentOrderId: orderId } });
      }

      await this.recalc(tx, orderId);
      const kot = await this.createKot(tx, orderId, branchId);
      return { orderId, kotId: kot?.id, created, tableId, previousTableStatus };
    });

    const order = await this.snapshot(result.orderId);
    await this.bus.publish(result.created ? EVENT.ORDER_CREATED : EVENT.ORDER_UPDATED, branchId, order, user?.id);
    if (result.kotId) await this.publishKot(result.kotId, user?.id);
    if (result.tableId) await this.tables.publishChange(result.tableId, result.previousTableStatus, user?.id);
    return { ...order, appendedToExisting: !result.created };
  }

  async addItems(user: AuthUser | undefined, orderId: string, dto: AddItemsDto, opts: { branchId?: string } = {}) {
    const existing = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!existing) throw new NotFoundException('Order not found');
    if (user) await this.access.assertBranchAccess(user, existing.branchId);
    else if (opts.branchId !== existing.branchId) throw new ForbiddenException('Order does not belong to this branch');
    if (!ACTIVE_STATUSES.includes(existing.status) || existing.paidAt) throw new ConflictException(`Cannot add items to a ${existing.paidAt ? 'paid' : existing.status} order`);

    const built = await this.buildItems(existing.branchId, dto.items);
    const kotId = await this.prisma.$transaction(async (tx) => {
      await tx.orderItem.createMany({ data: built.map((b) => ({ ...b, orderId })) });
      if (existing.status === 'ready') await tx.order.update({ where: { id: orderId }, data: { status: 'preparing' } });
      await this.recalc(tx, orderId);
      return (await this.createKot(tx, orderId, existing.branchId))?.id;
    });

    const order = await this.snapshot(orderId);
    await this.bus.publish(EVENT.ORDER_ITEMS_ADDED, order.branchId, { order, items: built }, user?.id);
    if (kotId) await this.publishKot(kotId, user?.id);
    return order;
  }

  async update(user: AuthUser, id: string, dto: UpdateOrderDto) {
    const existing = await this.get(user, id);
    if (existing.paidAt || existing.status === 'cancelled') throw new ConflictException('This order can no longer be edited');
    await this.prisma.$transaction(async (tx) => {
      await tx.order.update({ where: { id }, data: dto });
      if (dto.discount !== undefined) await this.recalc(tx, id);
    });
    const order = await this.snapshot(id);
    await this.bus.publish(EVENT.ORDER_UPDATED, order.branchId, order, user.id);
    return order;
  }

  // ───────────────────────── status ─────────────────────────

  async updateStatus(user: AuthUser, id: string, status: OrderStatus, reason?: string) {
    const existing = await this.get(user, id);
    if (existing.status === status) return existing;
    if (!TRANSITIONS[existing.status].includes(status)) {
      throw new ConflictException(`Cannot change order from "${existing.status}" to "${status}"`);
    }
    if (status === 'cancelled' && existing.paidAt) throw new ConflictException('A paid order cannot be cancelled');

    await this.prisma.$transaction(async (tx) => {
      await this.applyStatus(tx, existing, status, reason);
    });
    return this.afterStatusChange(id, existing.status, status, user.id, existing.tableId);
  }

  /** Mutates order + items (+ table/KOT for cancel). Runs inside a transaction. */
  async applyStatus(tx: Tx, order: { id: string; tableId: string | null; branchId: string }, status: OrderStatus, reason?: string) {
    const itemStatusFor: Partial<Record<OrderStatus, { from: OrderStatus[] }>> = {
      preparing: { from: ['pending'] },
      ready: { from: ['pending', 'preparing'] },
      served: { from: ['pending', 'preparing', 'ready'] },
    };
    const rule = itemStatusFor[status];
    if (rule) await tx.orderItem.updateMany({ where: { orderId: order.id, status: { in: rule.from } }, data: { status } });

    if (status === 'cancelled') {
      await tx.orderItem.updateMany({ where: { orderId: order.id, status: { not: 'cancelled' } }, data: { status: 'cancelled' } });
      await tx.kot.updateMany({ where: { orderId: order.id, status: { in: ['printed', 'acknowledged'] } }, data: { status: 'cancelled' } });
      if (order.tableId) await this.releaseTable(tx, order.tableId, order.id, 'available');
    }
    await tx.order.update({
      where: { id: order.id },
      data: { status, ...(status === 'served' ? { servedAt: new Date() } : {}), ...(reason && status === 'cancelled' ? { notes: `Cancelled: ${reason}` } : {}) },
    });
    if (status === 'cancelled') await this.recalc(tx, order.id);
  }

  /** Free a table (and any tables merged into it) if it still points at this order. */
  async releaseTable(tx: Tx, tableId: string, orderId: string, to: 'available' | 'cleaning') {
    const t = await tx.restaurantTable.findUnique({ where: { id: tableId } });
    if (!t || t.currentOrderId !== orderId) return;
    await tx.restaurantTable.updateMany({
      where: { OR: [{ id: tableId }, { mergedIntoId: tableId }] },
      data: { status: to, currentOrderId: null, mergedIntoId: null },
    });
  }

  async afterStatusChange(orderId: string, previousStatus: OrderStatus, status: OrderStatus, actorId?: string, tableId?: string | null) {
    const order = await this.snapshot(orderId);
    await this.bus.publish(EVENT.ORDER_STATUS_CHANGED, order.branchId, { order, status, previousStatus }, actorId);
    if (status === 'cancelled') {
      const kots = await this.prisma.kot.findMany({ where: { orderId }, select: { id: true } });
      for (const k of kots) {
        const kot = await this.prisma.kot.findUniqueOrThrow({ where: { id: k.id }, include: KOT_INCLUDE });
        await this.bus.publish(EVENT.KOT_UPDATED, kot.branchId, kot, actorId);
      }
    }
    if (tableId && status === 'cancelled') await this.tables.publishChange(tableId, 'occupied', actorId);
    return order;
  }

  /** Derive the order's status from its items (kitchen marks items individually). */
  private async syncStatusFromItems(orderId: string, actorId?: string) {
    const order = await this.prisma.order.findUniqueOrThrow({ where: { id: orderId }, include: { items: { where: { status: { not: 'cancelled' } } } } });
    if (!ACTIVE_STATUSES.includes(order.status) || order.items.length === 0) return;
    const all = (s: OrderStatus) => order.items.every((i) => i.status === s || i.status === 'served');
    let next: OrderStatus = order.status;
    if (all('ready')) next = 'ready';
    else if (order.items.some((i) => i.status === 'preparing' || i.status === 'ready')) next = 'preparing';
    else next = 'pending';
    if (next !== order.status) {
      await this.prisma.order.update({ where: { id: orderId }, data: { status: next } });
      await this.afterStatusChange(orderId, order.status, next, actorId);
    }
  }

  // ───────────────────────── items ─────────────────────────

  async updateItem(user: AuthUser, orderId: string, itemId: string, dto: UpdateOrderItemDto) {
    const order = await this.get(user, orderId);
    if (order.paidAt || !ACTIVE_STATUSES.includes(order.status)) throw new ConflictException('This order can no longer be edited');
    const item = order.items.find((i) => i.id === itemId);
    if (!item) throw new NotFoundException('Order item not found');
    if (item.billedByBillId) throw new ConflictException('This item has already been billed');

    if (dto.quantity !== undefined && dto.quantity !== item.quantity && item.status !== 'pending') {
      throw new ConflictException('Item is already being prepared. Cancel it and add a new one instead.');
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.orderItem.update({
        where: { id: itemId },
        data: {
          ...(dto.quantity !== undefined ? { quantity: dto.quantity, total: round2(num(item.unitPrice) * dto.quantity) } : {}),
          ...(dto.notes !== undefined ? { notes: dto.notes } : {}),
          ...(dto.status !== undefined ? { status: dto.status } : {}),
        },
      });
      await this.recalc(tx, orderId);
    });
    if (dto.status && dto.status !== item.status) await this.syncStatusFromItems(orderId, user.id);
    const fresh = await this.snapshot(orderId);
    await this.bus.publish(EVENT.ORDER_UPDATED, fresh.branchId, fresh, user.id);
    return fresh;
  }

  async deleteItem(user: AuthUser, orderId: string, itemId: string) {
    const order = await this.get(user, orderId);
    if (order.paidAt || !ACTIVE_STATUSES.includes(order.status)) throw new ConflictException('This order can no longer be edited');
    const item = order.items.find((i) => i.id === itemId);
    if (!item) throw new NotFoundException('Order item not found');
    if (item.status === 'ready' || item.status === 'served' || item.billedByBillId) throw new ConflictException('Item has already been prepared or billed and cannot be removed');

    const remaining = order.items.filter((i) => i.id !== itemId && i.status !== 'cancelled' && !i.billedByBillId).length;
    await this.prisma.$transaction(async (tx) => {
      if (item.kotId) await tx.orderItem.update({ where: { id: itemId }, data: { status: 'cancelled' } });
      else await tx.orderItem.delete({ where: { id: itemId } });
      await this.recalc(tx, orderId);
    });
    if (remaining === 0) return this.updateStatus(user, orderId, 'cancelled', 'All items removed');
    await this.syncStatusFromItems(orderId, user.id);
    const fresh = await this.snapshot(orderId);
    await this.bus.publish(EVENT.ORDER_UPDATED, fresh.branchId, fresh, user.id);
    return fresh;
  }

  // ───────────────────────── table split ─────────────────────────

  /** Move selected items (or part of a line) from one table's order to another table. */
  async splitToTable(user: AuthUser, sourceTableId: string, dto: SplitTableDto) {
    const source = await this.prisma.restaurantTable.findUnique({ where: { id: sourceTableId } });
    if (!source) throw new NotFoundException('Table not found');
    await this.access.assertBranchAccess(user, source.branchId);
    if (!source.currentOrderId) throw new BadRequestException('Source table has no active order');
    if (dto.targetTableId === sourceTableId) throw new BadRequestException('Choose a different target table');

    const sourceOrder = await this.prisma.order.findUniqueOrThrow({ where: { id: source.currentOrderId }, include: { items: true } });
    const moves = dto.itemIds.map((id) => {
      const item = sourceOrder.items.find((i) => i.id === id && i.status !== 'cancelled' && !i.billedByBillId);
      if (!item) throw new NotFoundException('Selected item not found on the source order');
      const qty = Math.min(item.quantity, Math.max(1, Math.floor(dto.quantities?.[id] ?? item.quantity)));
      return { item, qty };
    });
    const movingAll = sourceOrder.items.filter((i) => i.status !== 'cancelled' && !i.billedByBillId).every((i) => moves.some((m) => m.item.id === i.id && m.qty === i.quantity));
    if (movingAll) throw new BadRequestException('Cannot move every item. Use "shift table" to move the whole order.');

    const { targetOrderId, newOrder, targetPrevStatus } = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM restaurant_tables WHERE id = ${dto.targetTableId} FOR UPDATE`;
      const target = await tx.restaurantTable.findFirst({ where: { id: dto.targetTableId, branchId: source.branchId, isActive: true } });
      if (!target) throw new NotFoundException('Target table not found');
      let orderId: string | null = null;
      let isNew = false;
      if (target.currentOrderId) {
        const open = await tx.order.findFirst({ where: { id: target.currentOrderId, status: { in: ACTIVE_STATUSES }, paidAt: null } });
        orderId = open?.id ?? null;
      } else if (target.status !== 'available') {
        throw new ConflictException(`Table ${target.tableNumber} is not available`);
      }
      if (!orderId) {
        const orderNumber = await this.nextOrderNumber(source.branchId, 'ORD');
        const o = await tx.order.create({
          data: { branchId: source.branchId, tableId: target.id, waiterId: sourceOrder.waiterId, orderNumber, orderType: 'dine_in', status: sourceOrder.status },
        });
        orderId = o.id;
        isNew = true;
        await tx.restaurantTable.update({ where: { id: target.id }, data: { status: 'occupied', currentOrderId: orderId } });
      }
      for (const { item, qty } of moves) {
        if (qty === item.quantity) {
          await tx.orderItem.update({ where: { id: item.id }, data: { orderId } });
        } else {
          await tx.orderItem.update({ where: { id: item.id }, data: { quantity: item.quantity - qty, total: round2(num(item.unitPrice) * (item.quantity - qty)) } });
          const { id: _id, orderId: _oid, createdAt: _c, updatedAt: _u, ...copy } = item;
          await tx.orderItem.create({ data: { ...copy, addons: (copy.addons ?? undefined) as Prisma.InputJsonValue | undefined, orderId, quantity: qty, total: round2(num(item.unitPrice) * qty) } });
        }
      }
      await this.recalc(tx, sourceOrder.id);
      await this.recalc(tx, orderId);
      return { targetOrderId: orderId, newOrder: isNew, targetPrevStatus: target.status };
    });

    for (const id of [sourceOrder.id, targetOrderId]) {
      const o = await this.snapshot(id);
      await this.bus.publish(id === targetOrderId && newOrder ? EVENT.ORDER_CREATED : EVENT.ORDER_UPDATED, o.branchId, o, user.id);
    }
    await this.tables.publishChange(dto.targetTableId, targetPrevStatus, user.id);
    return { source: await this.snapshot(sourceOrder.id), target: await this.snapshot(targetOrderId) };
  }

  // ───────────────────────── kitchen tickets ─────────────────────────

  async listKots(user: AuthUser, q: KotQueryDto) {
    const branchId = await this.access.resolveBranchId(user, q.branchId);
    const statuses = (q.status ?? 'printed,acknowledged').split(',').map((s) => s.trim());
    return this.prisma.kot.findMany({
      where: { branchId, status: { in: statuses as any } },
      include: KOT_INCLUDE,
      orderBy: { createdAt: 'asc' },
      take: 200,
    });
  }

  async setKotStatus(user: AuthUser, id: string, status: 'printed' | 'acknowledged' | 'completed' | 'cancelled') {
    const existing = await this.prisma.kot.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('KOT not found');
    await this.access.assertBranchAccess(user, existing.branchId);
    const kot = await this.prisma.kot.update({ where: { id }, data: { status }, include: KOT_INCLUDE });

    // Acknowledging a ticket starts cooking; completing it marks its items ready.
    if (status === 'acknowledged' || status === 'completed') {
      const itemStatus = status === 'acknowledged' ? 'preparing' : 'ready';
      const from: OrderStatus[] = status === 'acknowledged' ? ['pending'] : ['pending', 'preparing'];
      await this.prisma.orderItem.updateMany({ where: { kotId: id, status: { in: from } }, data: { status: itemStatus } });
      await this.syncStatusFromItems(kot.orderId, user.id);
    }
    await this.bus.publish(EVENT.KOT_UPDATED, kot.branchId, kot, user.id);
    return kot;
  }
}
