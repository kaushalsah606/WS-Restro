import { InjectQueue } from '@nestjs/bullmq';
import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma, Printer } from '@prisma/client';
import { Queue } from 'bullmq';
import * as net from 'net';
import { AccessService } from '../../common/access/access.service';
import { AuthUser } from '../../common/decorators';
import { BILL_INCLUDE, KOT_INCLUDE } from '../../common/includes';
import { num } from '../../common/utils/money';
import { EventBus } from '../../infra/events/event-bus.service';
import { EVENT } from '../../infra/events/event-types';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { JOBS, QUEUES } from '../../infra/queue/queue.constants';
import { PrintTemplateConfig, renderBill, renderDrawer, renderKot, renderReport, renderTest } from './escpos';

export type PrintType = 'kot' | 'bill' | 'report' | 'test' | 'drawer';

@Injectable()
export class PrintersService {
  private readonly logger = new Logger(PrintersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
    private readonly bus: EventBus,
    @InjectQueue(QUEUES.PRINT) private readonly queue: Queue,
  ) {}

  // ───────────────────────── CRUD ─────────────────────────

  async list(user: AuthUser, branchId?: string) {
    const id = await this.access.resolveBranchId(user, branchId);
    return this.prisma.printer.findMany({ where: { branchId: id }, orderBy: { name: 'asc' } });
  }

  private async load(user: AuthUser, id: string) {
    const p = await this.prisma.printer.findUnique({ where: { id } });
    if (!p) throw new NotFoundException('Printer not found');
    await this.access.assertBranchAccess(user, p.branchId);
    return p;
  }

  private validate(d: { connectionType?: string; ipAddress?: string | null }) {
    if (d.connectionType === 'network' && !d.ipAddress) throw new BadRequestException('IP address is required for network printers');
  }

  async create(user: AuthUser, dto: any) {
    const branchId = await this.access.resolveBranchId(user, dto.branchId);
    this.validate(dto);
    const { branchId: _b, ...data } = dto;
    return this.prisma.$transaction(async (tx) => {
      if (data.isDefault) await tx.printer.updateMany({ where: { branchId }, data: { isDefault: false } });
      return tx.printer.create({ data: { ...data, branchId } });
    });
  }

  async update(user: AuthUser, id: string, dto: any) {
    const existing = await this.load(user, id);
    this.validate({ connectionType: dto.connectionType ?? existing.connectionType, ipAddress: dto.ipAddress ?? existing.ipAddress });
    const { branchId: _b, ...data } = dto;
    return this.prisma.$transaction(async (tx) => {
      if (data.isDefault) await tx.printer.updateMany({ where: { branchId: existing.branchId, NOT: { id } }, data: { isDefault: false } });
      return tx.printer.update({ where: { id }, data });
    });
  }

  async remove(user: AuthUser, id: string) {
    await this.load(user, id);
    await this.prisma.printer.delete({ where: { id } });
    return { id, deleted: true };
  }

  // ───────────────────────── routing ─────────────────────────

  /** Same precedence as the frontend: purpose+category → purpose → default → first active. */
  async resolvePrinter(branchId: string, purpose: 'kot' | 'bill' | 'report', categoryId?: string): Promise<Printer | null> {
    const printers = await this.prisma.printer.findMany({ where: { branchId, isActive: true }, orderBy: { name: 'asc' } });
    if (categoryId) {
      const hit = printers.find((p) => p.printFor.includes(purpose) && p.categories.includes(categoryId));
      if (hit) return hit;
    }
    return (
      printers.find((p) => p.printFor.includes(purpose) && p.categories.length === 0) ??
      printers.find((p) => p.printFor.includes(purpose)) ??
      printers.find((p) => p.isDefault) ??
      printers[0] ??
      null
    );
  }

  // ───────────────────────── enqueue ─────────────────────────

  async enqueue(branchId: string, type: PrintType, payload: Record<string, unknown>, printerId?: string | null) {
    const job = await this.prisma.printJob.create({ data: { branchId, printerId: printerId ?? null, type, payload: payload as Prisma.InputJsonValue } });
    await this.queue.add(JOBS.PRINT_SEND, { jobId: job.id }, { jobId: `print-${job.id}`, attempts: 5, backoff: { type: 'exponential', delay: 3000 } });
    return job;
  }

  /** Called by the workflow consumer when a KOT is created. One ticket per target printer. */
  async enqueueKot(kotId: string, isReprint = false) {
    const kot = await this.prisma.kot.findUnique({ where: { id: kotId }, include: KOT_INCLUDE });
    if (!kot) return [];
    const menu = await this.prisma.menuItem.findMany({ where: { id: { in: kot.items.map((i) => i.menuItemId) } }, select: { id: true, categoryId: true } });
    const catOf = new Map(menu.map((m) => [m.id, m.categoryId]));

    // group items by the printer that should receive them
    const groups = new Map<string, { printer: Printer | null; items: typeof kot.items }>();
    for (const item of kot.items) {
      const printer = await this.resolvePrinter(kot.branchId, 'kot', catOf.get(item.menuItemId));
      const key = printer?.id ?? 'none';
      if (!groups.has(key)) groups.set(key, { printer, items: [] });
      groups.get(key)!.items.push(item);
    }

    const jobs = [];
    for (const { printer, items } of groups.values()) {
      if (!printer) {
        this.logger.warn(`No active printer for KOT ${kot.kotNumber}; skipping print (KDS still shows it)`);
        continue;
      }
      const payload = {
        kotNumber: kot.kotNumber,
        orderNumber: kot.order.orderNumber,
        orderType: kot.order.orderType,
        tableNumber: kot.order.table?.tableNumber,
        waiterName: kot.order.waiter?.fullName,
        notes: kot.order.notes,
        isReprint: isReprint || kot.isReprint,
        createdAt: kot.createdAt,
        items: items.map((i) => ({ name: i.name, quantity: i.quantity, notes: i.notes, variant: i.variantName, addons: i.addons, course: i.course })),
      };
      jobs.push(await this.enqueue(kot.branchId, 'kot', payload, printer.id));
    }
    return jobs;
  }

  async enqueueBill(billId: string, printerId?: string) {
    const bill = await this.prisma.bill.findUnique({ where: { id: billId }, include: BILL_INCLUDE });
    if (!bill) throw new NotFoundException('Bill not found');
    const orderIds = bill.orders.length ? bill.orders.map((o) => o.orderId) : [bill.orderId];
    const items = await this.prisma.orderItem.findMany({
      where: { orderId: { in: orderIds }, status: { not: 'cancelled' }, ...(bill.kind === 'partial' ? { billedByBillId: bill.id } : { billedByBillId: null }) },
      orderBy: { createdAt: 'asc' },
    });
    const s = await this.access.getBranchSettings(bill.branchId);
    const printer = printerId ? await this.prisma.printer.findUnique({ where: { id: printerId } }) : await this.resolvePrinter(bill.branchId, 'bill');
    const payload = {
      billNumber: bill.billNumber,
      orderNumber: bill.order.orderNumber,
      tableNumber: bill.order.table?.tableNumber,
      generatedAt: bill.generatedAt,
      paidAt: bill.paidAt,
      items: items.map((i) => ({ name: i.name + (i.variantName ? ` (${i.variantName})` : ''), quantity: i.quantity, unitPrice: num(i.unitPrice), total: num(i.total) })),
      subtotal: num(bill.subtotal),
      tax: num(bill.tax),
      serviceCharge: num(bill.serviceCharge),
      discount: num(bill.discount),
      total: num(bill.total),
      payments: bill.payments.map((p) => ({ method: p.method, amount: num(p.amount) })),
      restaurant: { name: s.restaurantName, address: s.address, phone: s.phone },
    };
    return this.enqueue(bill.branchId, 'bill', payload, printer?.id);
  }

  async enqueueTest(user: AuthUser, printerId: string) {
    const p = await this.load(user, printerId);
    return this.enqueue(p.branchId, 'test', { printerName: p.name }, p.id);
  }

  async enqueueDrawer(user: AuthUser, printerId: string) {
    const p = await this.load(user, printerId);
    return this.enqueue(p.branchId, 'drawer', {}, p.id);
  }

  // ───────────────────────── jobs ─────────────────────────

  async listJobs(user: AuthUser, q: { branchId?: string; status?: string; limit?: number }) {
    const branchId = await this.access.resolveBranchId(user, q.branchId);
    return this.prisma.printJob.findMany({
      where: { branchId, ...(q.status ? { status: { in: q.status.split(',') as any } } : {}) },
      orderBy: { createdAt: 'desc' },
      take: Math.min(q.limit ?? 50, 200),
    });
  }

  async retryJob(user: AuthUser, id: string) {
    const job = await this.prisma.printJob.findUnique({ where: { id } });
    if (!job) throw new NotFoundException('Print job not found');
    await this.access.assertBranchAccess(user, job.branchId);
    if (job.status === 'completed' || job.status === 'printing') throw new ConflictException(`Job is ${job.status}`);
    await this.prisma.printJob.update({ where: { id }, data: { status: 'pending', error: null } });
    const existing = await this.queue.getJob(`print-${id}`);
    await existing?.remove().catch(() => undefined);
    await this.queue.add(JOBS.PRINT_SEND, { jobId: id }, { jobId: `print-${id}`, attempts: 5, backoff: { type: 'exponential', delay: 3000 } });
    return this.prisma.printJob.findUnique({ where: { id } });
  }

  async cancelJob(user: AuthUser, id: string) {
    const job = await this.prisma.printJob.findUnique({ where: { id } });
    if (!job) throw new NotFoundException('Print job not found');
    await this.access.assertBranchAccess(user, job.branchId);
    if (job.status === 'completed') throw new ConflictException('Job already printed');
    await (await this.queue.getJob(`print-${id}`))?.remove().catch(() => undefined);
    await this.prisma.printJob.update({ where: { id }, data: { status: 'failed', error: 'Cancelled by user' } });
    return { id, cancelled: true };
  }

  /** Delegated (USB) jobs are acknowledged by the terminal that printed them. */
  async ackJob(user: AuthUser, id: string, ok: boolean, error?: string) {
    const job = await this.prisma.printJob.findUnique({ where: { id } });
    if (!job) throw new NotFoundException('Print job not found');
    await this.access.assertBranchAccess(user, job.branchId);
    return this.prisma.printJob.update({ where: { id }, data: { status: ok ? 'completed' : 'failed', error: ok ? null : (error ?? 'Local print failed') } });
  }

  // ───────────────────────── execution (BullMQ worker) ─────────────────────────

  private async template(branchId: string, type: 'kot' | 'bill'): Promise<PrintTemplateConfig> {
    const t = await this.prisma.printTemplate.findFirst({ where: { branchId, type, isActive: true }, orderBy: { updatedAt: 'desc' } });
    return (t?.config as PrintTemplateConfig) ?? {};
  }

  private render(type: string, payload: any, cfg: PrintTemplateConfig): Buffer {
    switch (type) {
      case 'kot': return renderKot(payload, cfg);
      case 'bill': return renderBill(payload, cfg);
      case 'report': return renderReport(payload, cfg);
      case 'test': return renderTest(payload.printerName ?? 'Printer');
      case 'drawer': return renderDrawer();
      default: throw new BadRequestException(`Unknown print type ${type}`);
    }
  }

  /** Throws on failure so BullMQ retries with backoff. */
  async execute(jobId: string, attempt: number, maxAttempts: number) {
    const job = await this.prisma.printJob.findUnique({ where: { id: jobId }, include: { printer: true } });
    if (!job || job.status === 'completed') return;
    await this.prisma.printJob.update({ where: { id: jobId }, data: { status: 'printing', attempts: { increment: 1 } } });

    try {
      const printer = job.printer ?? (job.type === 'kot' || job.type === 'bill' ? await this.resolvePrinter(job.branchId, job.type as any) : null);
      const cfg = job.type === 'kot' || job.type === 'bill' ? await this.template(job.branchId, job.type) : {};
      const data = this.render(job.type, job.payload, cfg);

      if (!printer) throw new Error('No printer configured for this job');
      if (!printer.isActive) throw new Error(`Printer "${printer.name}" is disabled`);

      if (printer.connectionType === 'network') {
        await this.sendTcp(printer.ipAddress!, printer.port ?? 9100, data);
        await this.prisma.printJob.update({ where: { id: jobId }, data: { status: 'completed', error: null, printerId: printer.id } });
      } else {
        // USB / local printers can only be reached by a browser/agent on the same machine.
        await this.prisma.printJob.update({ where: { id: jobId }, data: { status: 'delegated', error: null, printerId: printer.id } });
        await this.bus.publish(EVENT.PRINT_JOB_READY, job.branchId, {
          jobId,
          type: job.type,
          printerId: printer.id,
          printerName: printer.name,
          base64: data.toString('base64'),
          payload: job.payload,
        });
      }
    } catch (e) {
      const final = attempt >= maxAttempts;
      await this.prisma.printJob.update({ where: { id: jobId }, data: { status: final ? 'failed' : 'pending', error: (e as Error).message } });
      throw e;
    }
  }

  private sendTcp(host: string, port: number, data: Buffer, timeoutMs = 5000): Promise<void> {
    return new Promise((resolve, reject) => {
      const socket = new net.Socket();
      const fail = (err: Error) => {
        socket.destroy();
        reject(err);
      };
      socket.setTimeout(timeoutMs, () => fail(new Error(`Printer ${host}:${port} timed out`)));
      socket.once('error', fail);
      socket.connect(port, host, () => {
        socket.write(data, (err) => {
          if (err) return fail(err);
          socket.end();
        });
      });
      socket.once('close', () => resolve());
    });
  }

  // ───────────────────────── templates ─────────────────────────

  async listTemplates(user: AuthUser, branchId?: string) {
    const id = await this.access.resolveBranchId(user, branchId);
    return this.prisma.printTemplate.findMany({ where: { branchId: id }, orderBy: [{ type: 'asc' }, { name: 'asc' }] });
  }

  async upsertTemplate(user: AuthUser, dto: { branchId?: string; type: 'kot' | 'bill'; name?: string; config: PrintTemplateConfig; isActive?: boolean }) {
    const branchId = await this.access.resolveBranchId(user, dto.branchId);
    const name = dto.name ?? 'default';
    return this.prisma.printTemplate.upsert({
      where: { branchId_type_name: { branchId, type: dto.type, name } },
      create: { branchId, type: dto.type, name, config: dto.config as any, isActive: dto.isActive ?? true },
      update: { config: dto.config as any, ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}) },
    });
  }

  async deleteTemplate(user: AuthUser, id: string) {
    const t = await this.prisma.printTemplate.findUnique({ where: { id } });
    if (!t) throw new NotFoundException('Template not found');
    await this.access.assertBranchAccess(user, t.branchId);
    await this.prisma.printTemplate.delete({ where: { id } });
    return { id, deleted: true };
  }
}
