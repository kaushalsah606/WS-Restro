import { Injectable, OnModuleInit } from '@nestjs/common';
import { AppConfig } from '../../config/app-config.service';
import { EventBus } from '../../infra/events/event-bus.service';
import { DomainEvent, EVENT } from '../../infra/events/event-types';
import { RealtimeGateway } from './realtime.gateway';
import { decimalsToNumbers } from '../../common/utils/case';

/**
 * Kafka -> Socket.IO bridge. Every domain event is translated into the socket events the
 * Next.js client listens for (see Frontend/src/lib/socket-client.ts).
 */
@Injectable()
export class RealtimeConsumer implements OnModuleInit {
  constructor(
    private readonly bus: EventBus,
    private readonly gateway: RealtimeGateway,
    private readonly config: AppConfig,
  ) {}

  onModuleInit() {
    if (!this.config.runsRealtime) return;
    this.bus.subscribe('realtime', (e) => this.handle(e));
  }

  private handle(event: DomainEvent) {
    const g = this.gateway;
    const branchId = event.branchId;
    const d: any = decimalsToNumbers(event.data);
    if (!branchId) return;

    switch (event.type) {
      case EVENT.ORDER_CREATED:
        g.toBranch(branchId, 'order:created', d);
        g.toKitchen(branchId, 'order:new', d);
        if (d.tableId) g.toTable(d.tableId, 'order:updated', d);
        break;

      case EVENT.ORDER_UPDATED:
      case EVENT.ORDER_ITEMS_ADDED: {
        const order = event.type === EVENT.ORDER_ITEMS_ADDED ? d.order : d;
        g.toBranch(branchId, 'order:updated', order);
        g.toKitchen(branchId, 'order:updated', order);
        g.toOrder(order.id, 'order:updated', order);
        if (order.tableId) g.toTable(order.tableId, 'order:updated', order);
        break;
      }

      case EVENT.ORDER_STATUS_CHANGED: {
        const payload = { orderId: d.order.id, status: d.status, previousStatus: d.previousStatus, order: d.order, branchId };
        g.toBranch(branchId, 'order:status:changed', payload);
        g.toBranch(branchId, 'order:updated', d.order);
        g.toKitchen(branchId, 'order:status:changed', payload);
        g.toKitchen(branchId, 'order:updated', d.order);
        g.toOrder(d.order.id, 'order:status:changed', payload);
        g.toOrder(d.order.id, 'order:updated', d.order);
        if (d.order.tableId) {
          g.toTable(d.order.tableId, 'order:status:changed', payload);
          g.toTable(d.order.tableId, 'order:updated', d.order);
        }
        break;
      }

      case EVENT.ORDER_DELETED:
        g.toBranch(branchId, 'order:deleted', d.id);
        g.toKitchen(branchId, 'order:deleted', d.id);
        break;

      case EVENT.TABLE_UPDATED:
        g.toBranch(branchId, 'table:updated', d);
        break;
      case EVENT.TABLE_STATUS_CHANGED:
        g.toBranch(branchId, 'table:status:changed', { tableId: d.table.id, status: d.table.status, previousStatus: d.previousStatus, table: d.table, branchId });
        g.toBranch(branchId, 'table:updated', d.table);
        break;
      case EVENT.TABLE_DELETED:
        g.toBranch(branchId, 'table:deleted', d);
        break;

      case EVENT.KOT_CREATED:
        g.toBranch(branchId, 'kot:created', d);
        g.toKitchen(branchId, 'kot:created', d);
        g.toKitchen(branchId, 'kot:new', d);
        break;
      case EVENT.KOT_UPDATED:
        g.toBranch(branchId, 'kot:updated', d);
        g.toKitchen(branchId, 'kot:updated', d);
        break;

      case EVENT.BILL_CREATED:
        g.toBranch(branchId, 'bill:created', d);
        break;
      case EVENT.BILL_UPDATED:
      case EVENT.BILL_PAID:
        g.toBranch(branchId, 'bill:updated', d);
        break;
      case EVENT.PAYMENT_RECEIVED:
        g.toBranch(branchId, 'bill:updated', d.bill);
        break;

      case EVENT.MENU_UPDATED:
        g.toBranch(branchId, 'menu:updated', d);
        break;
      case EVENT.MENU_DELETED:
        g.toBranch(branchId, 'menu:updated', { ...d, deleted: true });
        break;
      case EVENT.MENU_AVAILABILITY_CHANGED:
        g.toBranch(branchId, 'menu:availability:changed', d);
        g.toBranch(branchId, 'menu:updated', d.item ?? d);
        break;

      case EVENT.INVENTORY_UPDATED:
        g.toBranch(branchId, 'inventory:updated', d);
        break;
      case EVENT.INVENTORY_LOW_STOCK:
        g.toBranch(branchId, 'inventory:low_stock', d);
        break;

      case EVENT.RESERVATION_CREATED:
        g.toBranch(branchId, 'reservation:created', d);
        break;
      case EVENT.RESERVATION_UPDATED:
        g.toBranch(branchId, 'reservation:updated', d);
        break;

      case EVENT.NOTIFICATION_CREATED:
        if (d.userId) g.toUser(d.userId, 'notification', d);
        else g.toBranch(branchId, 'notification', d);
        break;

      case EVENT.PRINT_JOB_READY:
        // USB printers can't be reached from the server; the cashier terminal prints it locally.
        g.toBranch(branchId, 'print:job', d);
        break;

      default:
        break;
    }
  }
}
