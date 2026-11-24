'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { apiClient, errorMessage } from '@/lib/api-client';
import { useSocketEvents } from '@/hooks/useRealtime';
import { toast } from '@/hooks/use-toast';

/**
 * Data hooks for the dashboards and floor screens. They read the API in snake_case (the shape these
 * screens were written against), expose the mutations they need, and re-fetch (debounced) whenever
 * the matching Socket.IO events arrive, so every terminal stays in sync.
 */

// ───────────── types ─────────────

export interface TableWithOrder {
  id: string;
  branch_id: string;
  table_number: string;
  capacity: number;
  status: string;
  floor: string;
  area: string;
  qr_code?: string | null;
  current_order_id?: string | null;
  merged_into_id?: string | null;
  merged_with: string[];
  position_x?: number | null;
  position_y?: number | null;
  current_order?: { id: string; order_number: string; status: string; total: number; created_at: string } | null;
}
type Table = TableWithOrder;

export interface OrderItem {
  id: string;
  order_id: string;
  menu_item_id: string;
  name: string;
  quantity: number;
  unit_price: number;
  total: number;
  status: string;
  notes?: string | null;
  course?: string | null;
  kot_printed?: boolean;
  menu_items?: { name: string; price: number };
}

export interface Order {
  id: string;
  branch_id: string;
  table_id?: string | null;
  waiter_id?: string | null;
  order_number: string;
  order_type: string;
  status: string;
  subtotal: number;
  tax: number;
  service_charge: number;
  discount: number;
  total: number;
  is_held?: boolean;
  is_paid?: boolean;
  paid_at?: string | null;
  notes?: string | null;
  created_at: string;
  updated_at: string;
  table_number?: string | null;
  waiter_name?: string | null;
  /** lines, under the name the dashboards use */
  order_items: OrderItem[];
  items: OrderItem[];
  // aliases kept for older call sites
  totalAmount?: number;
}

export interface Bill {
  id: string;
  order_id: string;
  bill_number: string;
  subtotal: number;
  tax: number;
  service_charge: number;
  discount: number;
  total: number;
  status: string;
  kind: string;
  generated_at: string;
  paid_at?: string | null;
  payments?: { id: string; method: string; amount: number }[];
}

export interface InventoryItem {
  id: string;
  branch_id: string;
  name: string;
  category: string;
  unit: string;
  current_stock: number;
  min_stock_level: number;
  max_stock_level: number | null;
  cost_per_unit: number;
  last_restocked_at: string | null;
}

export interface Reservation {
  id: string;
  branch_id: string;
  table_id: string | null;
  customer_name: string;
  customer_phone: string;
  customer_email: string | null;
  party_size: number;
  reservation_date: string;
  reservation_time: string;
  duration_minutes: number;
  status: string;
  special_requests: string | null;
}

// ───────────── shared plumbing ─────────────

/** Fetch on mount, re-fetch on socket events (debounced), expose loading/error. */
function useLiveList<T>(path: string, params: Record<string, any> | undefined, events: string[], map?: (rows: any[]) => T[]) {
  const [data, setData] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const paramsKey = JSON.stringify(params ?? {});

  const load = useCallback(async () => {
    try {
      const rows = await apiClient.snake.get<any[]>(path, params);
      setData(map ? map(rows || []) : ((rows || []) as T[]));
      setError(null);
    } catch (e) {
      setError(e as Error);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, paramsKey]);

  useEffect(() => {
    load();
  }, [load]);

  const debounced = useCallback(() => {
    clearTimeout(timer.current);
    timer.current = setTimeout(load, 250);
  }, [load]);
  useEffect(() => () => clearTimeout(timer.current), []);

  useSocketEvents(events, debounced);
  return { data, setData, loading, error, reload: load };
}

async function run<T>(label: string, fn: () => Promise<T>, success?: string): Promise<T | undefined> {
  try {
    const r = await fn();
    if (success) toast({ title: success });
    return r;
  } catch (e) {
    toast({ title: label, description: errorMessage(e), variant: 'destructive' });
    return undefined;
  }
}

// ───────────── tables ─────────────

export const useTables = () => {
  const { data: tables, loading, error, reload } = useLiveList<Table>('/tables', undefined, [
    'table:updated',
    'table:status:changed',
    'table:deleted',
  ]);

  const updateTableStatus = useCallback(
    async (tableId: string, status: string) => {
      await run('Could not update table', () => apiClient.tables.updateStatus(tableId, status));
      await reload();
    },
    [reload]
  );

  const shiftTable = useCallback(
    async (fromTableId: string, toTableId: string) => {
      const ok = await run('Could not shift table', () => apiClient.tables.shift(fromTableId, toTableId), 'Table shifted');
      await reload();
      if (ok === undefined) throw new Error('shift failed');
    },
    [reload]
  );

  /** `tableIds` includes the primary table (as the merge dialog sends it). */
  const mergeTables = useCallback(
    async (tableIds: string[], primaryTableId: string) => {
      const ok = await run('Could not merge tables', () => apiClient.tables.merge(primaryTableId, tableIds.filter((id) => id !== primaryTableId)), 'Tables merged');
      await reload();
      if (ok === undefined) throw new Error('merge failed');
    },
    [reload]
  );

  const unmergeTables = useCallback(
    async (tableId: string) => {
      await run('Could not unmerge tables', () => apiClient.tables.unmerge(tableId), 'Tables unmerged');
      await reload();
    },
    [reload]
  );

  return { tables, loading, error, fetchTables: reload, updateTableStatus, shiftTable, mergeTables, unmergeTables };
};

// ───────────── orders ─────────────

const withLines = (rows: any[]): Order[] =>
  rows.map((o) => {
    const lines: OrderItem[] = (o.items || [])
      .filter((i: any) => !i.billed_by_bill_id)
      .map((i: any) => ({ ...i, menu_items: { name: i.name, price: i.unit_price } }));
    return { ...o, items: lines, order_items: lines, totalAmount: o.total };
  });

export const useOrders = () => {
  const { data: orders, setData, loading, error, reload } = useLiveList<Order>('/orders', { limit: 300 }, [
    'order:created',
    'order:updated',
    'order:status:changed',
    'order:deleted',
    'kot:updated',
  ], withLines);

  const updateOrderStatus = useCallback(
    async (orderId: string, status: string) => {
      // optimistic: the kitchen screen reacts instantly, the socket event reconciles
      setData((prev) => prev.map((o) => (o.id === orderId ? { ...o, status } : o)));
      const ok = await run('Could not update order', () => apiClient.orders.updateStatus(orderId, status));
      await reload();
      return ok !== undefined;
    },
    [reload, setData]
  );

  const updateOrderItemStatus = useCallback(
    async (itemId: string, status: string) => {
      const order = orders.find((o) => o.order_items.some((i) => i.id === itemId));
      if (!order) return false;
      const ok = await run('Could not update item', () => apiClient.orders.updateItem(order.id, itemId, { status }));
      await reload();
      return ok !== undefined;
    },
    [orders, reload]
  );

  return { orders, loading, error, fetchOrders: reload, updateOrderStatus, updateOrderItemStatus };
};

// ───────────── bills / inventory / reservations ─────────────

export const useBills = () => {
  const { data: bills, loading, error, reload } = useLiveList<Bill>('/billing', { limit: 300 }, ['bill:created', 'bill:updated']);
  return { bills, loading, error, fetchBills: reload };
};

export const useInventory = () => {
  const { data: inventory, loading, error, reload } = useLiveList<InventoryItem>('/inventory', undefined, ['inventory:updated', 'inventory:low_stock']);
  return { inventory, loading, error, fetchInventory: reload };
};

const todayStr = () => new Date().toISOString().slice(0, 10);

export const useReservations = () => {
  const { data: reservations, loading, error, reload } = useLiveList<Reservation>('/reservations', { from: todayStr() }, [
    'reservation:created',
    'reservation:updated',
  ]);
  return { reservations, loading, error, fetchReservations: reload };
};
