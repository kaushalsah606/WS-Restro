import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger, Module, OnModuleInit } from '@nestjs/common';
import { Job, Queue } from 'bullmq';
import { AppConfig } from '../../config/app-config.service';
import { num } from '../../common/utils/money';
import { EventBus } from '../../infra/events/event-bus.service';
import { DomainEvent, EVENT } from '../../infra/events/event-types';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { JOBS, QUEUES } from '../../infra/queue/queue.constants';
import { InventoryModule, InventoryService } from '../inventory/inventory.module';
import { NewNotification, NotificationsModule, NotificationsService } from '../notifications/notifications.module';
import { PrintersModule } from '../printers/printers.module';
import { PrintersService } from '../printers/printers.service';
import { ReportsModule, ReportsService } from '../reports/reports.module';
import { ReservationsModule, ReservationsService } from '../reservations/reservations.module';
import { startOfDay } from '../../common/utils/dates';

/**
 * Kafka consumer group "workflows": reacts to domain events and turns them into background work.
 * Handlers only enqueue BullMQ jobs, so retries/backoff are handled by the queue, not the consumer.
 */
@Injectable()
export class WorkflowConsumer implements OnModuleInit {
  private readonly logger = new Logger(WorkflowConsumer.name);

  constructor(
    private readonly bus: EventBus,
    private readonly config: AppConfig,
    private readonly printers: PrintersService,
    @InjectQueue(QUEUES.INVENTORY) private readonly inventoryQ: Queue,
    @InjectQueue(QUEUES.NOTIFICATIONS) private readonly notifyQ: Queue,
  ) {}

  onModuleInit() {
    if (!this.config.runsWorkers) return;
    this.bus.subscribe('workflows', (e) => this.handle(e));
  }

  private notify(n: NewNotification, dedupeKey: string) {
    // jobId makes the notification idempotent under Kafka redelivery
    return this.notifyQ.add(JOBS.NOTIFY, n, { jobId: `notify-${dedupeKey}` });
  }

  private async handle(e: DomainEvent) {
    const d = e.data;
    const branchId = e.branchId;
    if (!branchId) return;

    switch (e.type) {
      case EVENT.KOT_CREATED: {
        // print ticket(s) and deduct recipe ingredients
        await this.printers.enqueueKot(d.id, !!d.isReprint);
        if (!d.isReprint) await this.inventoryQ.add(JOBS.INVENTORY_DEDUCT_ORDER, { kotId: d.id }, { jobId: `deduct-${d.id}` });
        break;
      }

      case EVENT.BILL_PAID: {
        // auto-print the receipt when a bill printer exists
        if (await this.printers.resolvePrinter(branchId, 'bill')) await this.printers.enqueueBill(d.id);
        break;
      }

      case EVENT.ORDER_CREATED: {
        // QR / self-service orders have no waiter: tell the floor.
        if (!d.waiterId) {
          await this.notify(
            { branchId, type: 'order.new', title: 'New QR order', message: `${d.orderNumber}${d.table?.tableNumber ? ` · Table ${d.table.tableNumber}` : ''}`, data: { orderId: d.id } },
            `order-new-${d.id}`,
          );
        }
        break;
      }

      case EVENT.ORDER_STATUS_CHANGED: {
        const { order, status, previousStatus } = d;
        if (status === 'ready') {
          await this.notify(
            {
              branchId,
              userId: order.waiterId ?? null,
              type: 'order.ready',
              title: 'Order ready',
              message: `${order.orderNumber}${order.table?.tableNumber ? ` · Table ${order.table.tableNumber}` : ''} is ready to serve`,
              data: { orderId: order.id },
            },
            `order-ready-${order.id}-${e.id}`,
          );
        }
        if (status === 'cancelled' && previousStatus === 'pending') {
          await this.inventoryQ.add(JOBS.INVENTORY_DEDUCT_ORDER, { restoreOrderId: order.id }, { jobId: `restore-${order.id}` });
        }
        break;
      }

      case EVENT.INVENTORY_LOW_STOCK:
        await this.notify(
          { branchId, type: 'inventory.low', title: 'Low stock', message: `${d.name}: ${num(d.currentStock)} ${d.unit} left (min ${num(d.minStockLevel)})`, data: { inventoryId: d.id } },
          `low-${d.id}-${e.id}`,
        );
        break;

      case EVENT.RESERVATION_CREATED:
        await this.notify(
          { branchId, type: 'reservation.new', title: 'New reservation', message: `${d.customerName} · ${d.partySize} guests · ${String(d.reservationDate).slice(0, 10)} ${d.reservationTime}`, data: { reservationId: d.id } },
          `resv-${d.id}`,
        );
        break;

      default:
        break;
    }
  }
}

/** Kafka consumer group "audit": immutable trail of every domain event. */
@Injectable()
export class AuditConsumer implements OnModuleInit {
  constructor(
    private readonly bus: EventBus,
    private readonly prisma: PrismaService,
    private readonly config: AppConfig,
  ) {}

  onModuleInit() {
    if (!this.config.runsWorkers) return;
    this.bus.subscribe('audit', (e) => this.write(e));
  }

  /** Keep scalar fields only so the audit table stays small. */
  private compact(v: any, depth = 0): any {
    if (v === null || typeof v !== 'object') return v;
    if (Array.isArray(v)) return depth > 1 ? undefined : v.slice(0, 20).map((x) => this.compact(x, depth + 1));
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v)) {
      if (val === null || typeof val !== 'object') out[k] = val;
      else if (depth < 1 && !Array.isArray(val)) out[k] = this.compact(val, depth + 1);
    }
    return out;
  }

  private async write(e: DomainEvent) {
    const entity = e.data?.id ?? e.data?.order?.id ?? e.data?.table?.id ?? e.data?.bill?.id ?? null;
    await this.prisma.auditLog.createMany({
      data: [{ eventId: e.id, type: e.type, branchId: e.branchId, actorId: e.actorId ?? null, entityId: entity, payload: this.compact(e.data) ?? {}, occurredAt: new Date(e.occurredAt) }],
      skipDuplicates: true,
    });
  }
}

// ───────────────────────── BullMQ processors ─────────────────────────

@Processor(QUEUES.INVENTORY, { concurrency: 2 })
export class InventoryProcessor extends WorkerHost {
  private readonly logger = new Logger(InventoryProcessor.name);
  constructor(private readonly inventory: InventoryService) {
    super();
  }

  async process(job: Job<{ kotId?: string; restoreOrderId?: string }>) {
    if (job.data.kotId) {
      const n = await this.inventory.deductForKot(job.data.kotId);
      if (n) this.logger.debug(`Deducted ${n} ingredient(s) for KOT ${job.data.kotId}`);
    } else if (job.data.restoreOrderId) {
      await this.inventory.restoreForOrder(job.data.restoreOrderId);
    }
  }
}

@Processor(QUEUES.NOTIFICATIONS, { concurrency: 5 })
export class NotificationsProcessor extends WorkerHost {
  constructor(private readonly notifications: NotificationsService) {
    super();
  }
  async process(job: Job<NewNotification>) {
    await this.notifications.create(job.data);
  }
}

@Processor(QUEUES.SCHEDULED, { concurrency: 1 })
export class ScheduledProcessor extends WorkerHost {
  private readonly logger = new Logger(ScheduledProcessor.name);

  constructor(
    private readonly reservations: ReservationsService,
    private readonly reports: ReportsService,
    private readonly inventory: InventoryService,
    private readonly notifications: NotificationsService,
    private readonly prisma: PrismaService,
  ) {
    super();
  }

  async process(job: Job) {
    switch (job.name) {
      case JOBS.RESERVATION_SWEEP:
        return this.reservations.sweep();
      case JOBS.DAILY_REPORT:
        return this.dailyReport();
      case JOBS.INVENTORY_LOW_STOCK_SCAN:
        return this.lowStockScan();
      default:
        this.logger.warn(`Unknown scheduled job ${job.name}`);
    }
  }

  private async dailyReport() {
    const branches = await this.prisma.branch.findMany({ where: { isActive: true }, select: { id: true, name: true } });
    const from = startOfDay();
    for (const b of branches) {
      const agg = await this.prisma.bill.aggregate({ where: { branchId: b.id, status: 'completed', paidAt: { gte: from } }, _sum: { total: true }, _count: true });
      const orders = await this.prisma.order.count({ where: { branchId: b.id, createdAt: { gte: from }, status: { not: 'cancelled' } } });
      await this.notifications.create({
        branchId: b.id,
        type: 'report.daily',
        title: `Daily summary – ${b.name}`,
        message: `Revenue ${num(agg._sum.total).toFixed(2)} from ${agg._count} bills · ${orders} orders`,
        data: { revenue: num(agg._sum.total), bills: agg._count, orders },
      });
    }
    return { branches: branches.length };
  }

  private async lowStockScan() {
    const branches = await this.prisma.branch.findMany({ where: { isActive: true }, select: { id: true } });
    for (const b of branches) {
      const low = await this.inventory.lowStock(b.id);
      if (low.length) {
        await this.notifications.create({
          branchId: b.id,
          type: 'inventory.low_summary',
          title: `${low.length} item(s) low on stock`,
          message: low.slice(0, 5).map((i) => i.name).join(', ') + (low.length > 5 ? '…' : ''),
          data: { count: low.length },
        });
      }
    }
  }
}

/** Registers repeatable jobs (idempotent, safe with several replicas). */
@Injectable()
export class SchedulerService implements OnModuleInit {
  private readonly logger = new Logger(SchedulerService.name);

  constructor(
    private readonly config: AppConfig,
    @InjectQueue(QUEUES.SCHEDULED) private readonly queue: Queue,
  ) {}

  async onModuleInit() {
    if (!this.config.runsWorkers) return;
    try {
      await this.queue.upsertJobScheduler('reservation-sweep', { every: 60_000 }, { name: JOBS.RESERVATION_SWEEP, opts: { removeOnComplete: true, removeOnFail: 20 } });
      await this.queue.upsertJobScheduler('daily-report', { pattern: '55 23 * * *' }, { name: JOBS.DAILY_REPORT, opts: { removeOnComplete: true } });
      await this.queue.upsertJobScheduler('low-stock-scan', { pattern: '0 8 * * *' }, { name: JOBS.INVENTORY_LOW_STOCK_SCAN, opts: { removeOnComplete: true } });
      this.logger.log('Scheduled jobs registered (reservation sweep, daily report, low-stock scan)');
    } catch (e) {
      this.logger.error(`Failed to register schedulers: ${(e as Error).message}`);
    }
  }
}

@Module({
  imports: [PrintersModule, InventoryModule, NotificationsModule, ReservationsModule, ReportsModule],
  providers: [WorkflowConsumer, AuditConsumer, InventoryProcessor, NotificationsProcessor, ScheduledProcessor, SchedulerService],
})
export class WorkflowsModule {}
