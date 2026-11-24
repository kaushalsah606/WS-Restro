import { Controller, Get, Injectable, Module, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Prisma } from '@prisma/client';
import { IsIn, IsOptional, IsString, IsUUID, IsInt, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';
import { AccessService } from '../../common/access/access.service';
import { AuthUser, CurrentUser, MANAGERS, BILLING_STAFF, Roles } from '../../common/decorators';
import { DateRangeQuery, daysAgo, resolveRange, startOfDay, ymd } from '../../common/utils/dates';
import { num, round2 } from '../../common/utils/money';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { CacheService } from '../../infra/redis/redis.module';
import { ORDER_INCLUDE } from '../../common/includes';

export class ReportQueryDto implements DateRangeQuery {
  @ApiPropertyOptional() @IsOptional() @IsUUID() branchId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() startDate?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() endDate?: string;
  @ApiPropertyOptional({ enum: ['today', 'week', 'month', 'quarter', 'year'] }) @IsOptional() @IsIn(['today', 'week', 'month', 'quarter', 'year']) period?: DateRangeQuery['period'];
  @ApiPropertyOptional({ enum: ['hour', 'day', 'month'] }) @IsOptional() @IsIn(['hour', 'day', 'month']) groupBy?: 'hour' | 'day' | 'month';
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number;
}

const n = (v: unknown) => (typeof v === 'bigint' ? Number(v) : num(v as any));

@Injectable()
export class ReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
    private readonly cache: CacheService,
  ) {}

  private async scope(user: AuthUser, q: ReportQueryDto) {
    const branchId = await this.access.resolveBranchId(user, q.branchId);
    const { from, to } = resolveRange(q);
    return { branchId, from, to, key: `report:${branchId}` };
  }

  // ───────────────────────── dashboard ─────────────────────────

  async dashboard(user: AuthUser, branchIdParam?: string) {
    const branchId = await this.access.resolveBranchId(user, branchIdParam);
    return this.cache.wrap(`report:${branchId}:dashboard`, 10, async () => {
      const today = startOfDay();
      const [sales, todayOrders, activeOrders, tables, recentOrders, topItems, openKots, lowStock, reservations] = await Promise.all([
        this.prisma.bill.aggregate({ where: { branchId, status: 'completed', paidAt: { gte: today } }, _sum: { total: true }, _count: true }),
        this.prisma.order.count({ where: { branchId, createdAt: { gte: today }, status: { not: 'cancelled' } } }),
        this.prisma.order.count({ where: { branchId, status: { in: ['pending', 'preparing', 'ready'] }, paidAt: null } }),
        this.prisma.restaurantTable.groupBy({ by: ['status'], where: { branchId, isActive: true, mergedIntoId: null }, _count: true }),
        this.prisma.order.findMany({ where: { branchId }, include: ORDER_INCLUDE, orderBy: { createdAt: 'desc' }, take: 5 }),
        this.topItemsQuery(branchId, today, new Date(), 5),
        this.prisma.kot.count({ where: { branchId, status: { in: ['printed', 'acknowledged'] } } }),
        this.prisma.$queryRaw<{ c: bigint }[]>`SELECT COUNT(*) c FROM inventory WHERE "branchId" = ${branchId} AND "currentStock" <= "minStockLevel"`,
        this.prisma.reservation.count({ where: { branchId, reservationDate: { gte: today }, status: { in: ['pending', 'confirmed'] } } }),
      ]);
      const totalTables = tables.reduce((s, t) => s + t._count, 0);
      const byStatus = Object.fromEntries(tables.map((t) => [t.status, t._count]));
      const todaySales = num(sales._sum.total);
      return {
        todaySales,
        todayBills: sales._count,
        todayOrders,
        activeOrders,
        occupiedTables: byStatus['occupied'] ?? 0,
        totalTables,
        tableStatus: byStatus,
        avgOrderValue: sales._count ? round2(todaySales / sales._count) : 0,
        pendingKots: openKots,
        lowStockItems: n(lowStock[0]?.c ?? 0),
        upcomingReservations: reservations,
        topSellingItems: topItems.map((t) => ({ name: t.name, quantity: t.quantity })),
        recentOrders,
      };
    });
  }

  // ───────────────────────── sales ─────────────────────────

  async sales(user: AuthUser, q: ReportQueryDto) {
    const { branchId, from, to, key } = await this.scope(user, q);
    const unit = q.groupBy ?? (ymd(from) === ymd(to) ? 'hour' : 'day');
    return this.cache.wrap(`${key}:sales:${unit}:${from.toISOString()}:${to.toISOString()}`, 30, async () => {
      const rows = await this.prisma.$queryRaw<{ bucket: Date; revenue: unknown; orders: bigint; tax: unknown; discount: unknown }[]>(Prisma.sql`
        SELECT date_trunc(${unit}, "paidAt") AS bucket,
               COALESCE(SUM("total"), 0) AS revenue,
               COUNT(*) AS orders,
               COALESCE(SUM("tax"), 0) AS tax,
               COALESCE(SUM("discount"), 0) AS discount
        FROM bills
        WHERE "branchId" = ${branchId} AND "status" = 'completed'
          AND "paidAt" >= ${from} AND "paidAt" <= ${to}
        GROUP BY 1 ORDER BY 1`);
      const map = new Map(rows.map((r) => [this.bucketKey(r.bucket, unit), r]));
      const out: { date: string; revenue: number; orders: number; tax: number; discount: number }[] = [];
      if (unit === 'day') {
        for (let d = startOfDay(from); d <= to; d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)) {
          const k = this.localYmd(d);
          const r = map.get(k);
          out.push({ date: k, revenue: n(r?.revenue), orders: n(r?.orders), tax: n(r?.tax), discount: n(r?.discount) });
        }
      } else {
        for (const [k, r] of map) out.push({ date: k, revenue: n(r.revenue), orders: n(r.orders), tax: n(r.tax), discount: n(r.discount) });
      }
      return out;
    });
  }

  private localYmd(d: Date) {
    const p = (x: number) => String(x).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }
  private bucketKey(d: Date, unit: string) {
    if (unit === 'hour') return d.toISOString().slice(0, 13) + ':00';
    if (unit === 'month') return d.toISOString().slice(0, 7);
    return this.localYmd(new Date(d));
  }

  async summary(user: AuthUser, q: ReportQueryDto) {
    const { branchId, from, to, key } = await this.scope(user, q);
    return this.cache.wrap(`${key}:summary:${from.toISOString()}:${to.toISOString()}`, 30, async () => {
      const span = to.getTime() - from.getTime();
      const prevFrom = new Date(from.getTime() - span - 1);
      const prevTo = new Date(from.getTime() - 1);
      const agg = (a: Date, b: Date) =>
        this.prisma.bill.aggregate({
          where: { branchId, status: 'completed', paidAt: { gte: a, lte: b } },
          _sum: { total: true, tax: true, serviceCharge: true, discount: true, subtotal: true },
          _count: true,
        });
      const [cur, prev, cancelled, orders] = await Promise.all([
        agg(from, to),
        agg(prevFrom, prevTo),
        this.prisma.order.count({ where: { branchId, status: 'cancelled', createdAt: { gte: from, lte: to } } }),
        this.prisma.order.count({ where: { branchId, status: { not: 'cancelled' }, createdAt: { gte: from, lte: to } } }),
      ]);
      const revenue = num(cur._sum.total);
      const prevRevenue = num(prev._sum.total);
      return {
        from,
        to,
        revenue,
        bills: cur._count,
        orders,
        cancelledOrders: cancelled,
        tax: num(cur._sum.tax),
        serviceCharge: num(cur._sum.serviceCharge),
        discount: num(cur._sum.discount),
        avgBillValue: cur._count ? round2(revenue / cur._count) : 0,
        previous: { revenue: prevRevenue, bills: prev._count },
        revenueChangePct: prevRevenue ? round2(((revenue - prevRevenue) / prevRevenue) * 100) : null,
      };
    });
  }

  // ───────────────────────── breakdowns ─────────────────────────

  private async topItemsQuery(branchId: string, from: Date, to: Date, limit: number) {
    const rows = await this.prisma.$queryRaw<{ menuItemId: string; name: string; quantity: bigint; revenue: unknown }[]>(Prisma.sql`
      SELECT oi."menuItemId", oi."name", SUM(oi."quantity") AS quantity, SUM(oi."total") AS revenue
      FROM order_items oi JOIN orders o ON o."id" = oi."orderId"
      WHERE o."branchId" = ${branchId} AND o."status" <> 'cancelled' AND oi."status" <> 'cancelled'
        AND o."createdAt" >= ${from} AND o."createdAt" <= ${to}
      GROUP BY oi."menuItemId", oi."name"
      ORDER BY quantity DESC, revenue DESC
      LIMIT ${limit}`);
    return rows.map((r) => ({ menuItemId: r.menuItemId, name: r.name, quantity: n(r.quantity), revenue: n(r.revenue) }));
  }

  async topItems(user: AuthUser, q: ReportQueryDto) {
    const { branchId, from, to, key } = await this.scope(user, q);
    return this.cache.wrap(`${key}:top:${q.limit ?? 10}:${from.toISOString()}:${to.toISOString()}`, 30, () => this.topItemsQuery(branchId, from, to, q.limit ?? 10));
  }

  async categories(user: AuthUser, q: ReportQueryDto) {
    const { branchId, from, to, key } = await this.scope(user, q);
    return this.cache.wrap(`${key}:cats:${from.toISOString()}:${to.toISOString()}`, 30, async () => {
      const rows = await this.prisma.$queryRaw<{ category: string; quantity: bigint; revenue: unknown }[]>(Prisma.sql`
        SELECT c."name" AS category, SUM(oi."quantity") AS quantity, SUM(oi."total") AS revenue
        FROM order_items oi
        JOIN orders o ON o."id" = oi."orderId"
        JOIN menu_items m ON m."id" = oi."menuItemId"
        JOIN categories c ON c."id" = m."categoryId"
        WHERE o."branchId" = ${branchId} AND o."status" <> 'cancelled' AND oi."status" <> 'cancelled'
          AND o."createdAt" >= ${from} AND o."createdAt" <= ${to}
        GROUP BY c."name" ORDER BY revenue DESC`);
      return rows.map((r) => ({ category: r.category, quantity: n(r.quantity), revenue: n(r.revenue) }));
    });
  }

  async paymentMethods(user: AuthUser, q: ReportQueryDto) {
    const { branchId, from, to, key } = await this.scope(user, q);
    return this.cache.wrap(`${key}:pay:${from.toISOString()}:${to.toISOString()}`, 30, async () => {
      const rows = await this.prisma.payment.groupBy({
        by: ['method'],
        where: { bill: { branchId, status: 'completed' }, createdAt: { gte: from, lte: to } },
        _sum: { amount: true },
        _count: true,
      });
      return rows.map((r) => ({ method: r.method, amount: num(r._sum.amount), count: r._count }));
    });
  }

  async staff(user: AuthUser, q: ReportQueryDto) {
    const { branchId, from, to, key } = await this.scope(user, q);
    return this.cache.wrap(`${key}:staff:${from.toISOString()}:${to.toISOString()}`, 30, async () => {
      const rows = await this.prisma.$queryRaw<{ waiterId: string; name: string | null; orders: bigint; revenue: unknown }[]>(Prisma.sql`
        SELECT o."waiterId", u."fullName" AS name, COUNT(*) AS orders, COALESCE(SUM(o."total"), 0) AS revenue
        FROM orders o JOIN users u ON u."id" = o."waiterId"
        WHERE o."branchId" = ${branchId} AND o."status" <> 'cancelled' AND o."waiterId" IS NOT NULL
          AND o."createdAt" >= ${from} AND o."createdAt" <= ${to}
        GROUP BY o."waiterId", u."fullName" ORDER BY revenue DESC`);
      return rows.map((r) => ({
        waiterId: r.waiterId,
        name: r.name ?? 'Unknown',
        orders: n(r.orders),
        revenue: n(r.revenue),
        avgOrderValue: n(r.orders) ? round2(n(r.revenue) / n(r.orders)) : 0,
      }));
    });
  }

  async peakHours(user: AuthUser, q: ReportQueryDto) {
    const { branchId, from, to, key } = await this.scope(user, q);
    return this.cache.wrap(`${key}:hours:${from.toISOString()}:${to.toISOString()}`, 60, async () => {
      const rows = await this.prisma.$queryRaw<{ hour: number; orders: bigint; revenue: unknown }[]>(Prisma.sql`
        SELECT EXTRACT(HOUR FROM "createdAt")::int AS hour, COUNT(*) AS orders, COALESCE(SUM("total"), 0) AS revenue
        FROM orders
        WHERE "branchId" = ${branchId} AND "status" <> 'cancelled' AND "createdAt" >= ${from} AND "createdAt" <= ${to}
        GROUP BY 1 ORDER BY 1`);
      const byHour = new Map(rows.map((r) => [r.hour, r]));
      return Array.from({ length: 24 }, (_, h) => ({ hour: h, orders: n(byHour.get(h)?.orders), revenue: n(byHour.get(h)?.revenue) }));
    });
  }

  async orderTypes(user: AuthUser, q: ReportQueryDto) {
    const { branchId, from, to } = await this.scope(user, q);
    const rows = await this.prisma.order.groupBy({
      by: ['orderType'],
      where: { branchId, status: { not: 'cancelled' }, createdAt: { gte: from, lte: to } },
      _count: true,
      _sum: { total: true },
    });
    return rows.map((r) => ({ orderType: r.orderType, orders: r._count, revenue: num(r._sum.total) }));
  }

  /** Everything the reports screens need in one round-trip (served at /billing/reports). */
  async composite(user: AuthUser, q: ReportQueryDto) {
    const [summary, salesByDate, paymentMethods, topItems, categories, staff, peakHours, orderTypes] = await Promise.all([
      this.summary(user, q),
      this.sales(user, q),
      this.paymentMethods(user, q),
      this.topItems(user, q),
      this.categories(user, q),
      this.staff(user, q),
      this.peakHours(user, q),
      this.orderTypes(user, q),
    ]);
    return { summary, salesByDate, paymentMethods, topItems, categories, staff, peakHours, orderTypes };
  }

  /** Raw bills for the "detailed reports" table. */
  async bills(user: AuthUser, q: ReportQueryDto) {
    const { branchId, from, to } = await this.scope(user, q);
    return this.prisma.bill.findMany({ where: { branchId, status: 'completed', paidAt: { gte: from, lte: to } }, orderBy: { paidAt: 'desc' }, take: 5000 });
  }

  /** Inventory valuation + low-stock list. */
  async inventory(user: AuthUser, q: ReportQueryDto) {
    const branchId = await this.access.resolveBranchId(user, q.branchId);
    const items = await this.prisma.inventoryItem.findMany({ where: { branchId } });
    const valuation = items.reduce((s, i) => s + num(i.currentStock) * num(i.costPerUnit), 0);
    const low = items.filter((i) => num(i.currentStock) <= num(i.minStockLevel));
    return { totalItems: items.length, valuation: round2(valuation), lowStockCount: low.length, lowStock: low };
  }
}

@ApiTags('reports')
@ApiBearerAuth()
@Roles(...MANAGERS, 'CASHIER')
@Controller('reports')
export class ReportsController {
  constructor(private readonly svc: ReportsService) {}

  @Roles(...BILLING_STAFF, 'WAITER', 'KITCHEN_STAFF')
  @Get('dashboard')
  dashboard(@CurrentUser() u: AuthUser, @Query('branchId') branchId?: string) {
    return this.svc.dashboard(u, branchId);
  }
  @Get('summary') summary(@CurrentUser() u: AuthUser, @Query() q: ReportQueryDto) { return this.svc.summary(u, q); }
  @Get('sales') sales(@CurrentUser() u: AuthUser, @Query() q: ReportQueryDto) { return this.svc.sales(u, q); }
  @Get('top-items') top(@CurrentUser() u: AuthUser, @Query() q: ReportQueryDto) { return this.svc.topItems(u, q); }
  @Get('categories') cats(@CurrentUser() u: AuthUser, @Query() q: ReportQueryDto) { return this.svc.categories(u, q); }
  @Get('payment-methods') pay(@CurrentUser() u: AuthUser, @Query() q: ReportQueryDto) { return this.svc.paymentMethods(u, q); }
  @Get('staff') staff(@CurrentUser() u: AuthUser, @Query() q: ReportQueryDto) { return this.svc.staff(u, q); }
  @Get('peak-hours') hours(@CurrentUser() u: AuthUser, @Query() q: ReportQueryDto) { return this.svc.peakHours(u, q); }
  @Get('order-types') types(@CurrentUser() u: AuthUser, @Query() q: ReportQueryDto) { return this.svc.orderTypes(u, q); }
  @Get('inventory') inventory(@CurrentUser() u: AuthUser, @Query() q: ReportQueryDto) { return this.svc.inventory(u, q); }
  @Get('overview') overview(@CurrentUser() u: AuthUser, @Query() q: ReportQueryDto) { return this.svc.composite(u, q); }
}

@Module({ controllers: [ReportsController], providers: [ReportsService], exports: [ReportsService] })
export class ReportsModule {}
