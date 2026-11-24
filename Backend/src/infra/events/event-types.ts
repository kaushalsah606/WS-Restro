/**
 * Domain events published to Kafka (topic is derived from the first segment of the type).
 * Every event carries a snapshot of the affected entity so consumers need no DB reads.
 */
export const EVENT = {
  ORDER_CREATED: 'order.created',
  ORDER_UPDATED: 'order.updated',
  ORDER_STATUS_CHANGED: 'order.status_changed',
  ORDER_DELETED: 'order.deleted',
  ORDER_ITEMS_ADDED: 'order.items_added',

  TABLE_UPDATED: 'table.updated',
  TABLE_STATUS_CHANGED: 'table.status_changed',
  TABLE_DELETED: 'table.deleted',

  KOT_CREATED: 'kot.created',
  KOT_UPDATED: 'kot.updated',

  BILL_CREATED: 'bill.created',
  BILL_UPDATED: 'bill.updated',
  BILL_PAID: 'bill.paid',
  PAYMENT_RECEIVED: 'bill.payment_received',

  MENU_UPDATED: 'menu.updated',
  MENU_DELETED: 'menu.deleted',
  MENU_AVAILABILITY_CHANGED: 'menu.availability_changed',

  INVENTORY_UPDATED: 'inventory.updated',
  INVENTORY_LOW_STOCK: 'inventory.low_stock',
  INVENTORY_DELETED: 'inventory.deleted',

  RESERVATION_CREATED: 'reservation.created',
  RESERVATION_UPDATED: 'reservation.updated',

  NOTIFICATION_CREATED: 'notification.created',
  PRINT_JOB_READY: 'print.job_ready',
  USER_UPDATED: 'user.updated',
} as const;

export type EventType = (typeof EVENT)[keyof typeof EVENT];

export interface DomainEvent<T = any> {
  id: string;
  type: EventType;
  branchId: string | null;
  occurredAt: string;
  actorId?: string | null;
  data: T;
}

export const TOPIC_SUFFIXES = [
  'order',
  'table',
  'kot',
  'bill',
  'menu',
  'inventory',
  'reservation',
  'notification',
  'print',
  'user',
] as const;

export function topicSuffixFor(type: string): string {
  const head = type.split('.')[0];
  return (TOPIC_SUFFIXES as readonly string[]).includes(head) ? head : 'misc';
}
