export const QUEUES = {
  PRINT: 'print',
  INVENTORY: 'inventory',
  NOTIFICATIONS: 'notifications',
  SCHEDULED: 'scheduled',
  SEARCH: 'search-reindex',
} as const;

export const JOBS = {
  PRINT_SEND: 'print.send',
  INVENTORY_DEDUCT_ORDER: 'inventory.deduct-order',
  INVENTORY_LOW_STOCK_SCAN: 'inventory.low-stock-scan',
  NOTIFY: 'notify',
  RESERVATION_SWEEP: 'reservation.sweep',
  DAILY_REPORT: 'report.daily',
  SEARCH_REINDEX: 'search.reindex',
} as const;
