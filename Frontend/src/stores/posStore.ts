'use client';

import { create } from 'zustand';
import { apiClient, errorMessage } from '@/lib/api-client';
import type { Table, Order, OrderItem, MenuItem, Category, DashboardStats, User } from '@/types/pos';

/**
 * POS client store. Menu, tables and orders live in the backend; this store caches them for the
 * order-taking screens (OrderPanel / OrdersList / MenuManagement) and keeps the local cart.
 * Call `init()` once after sign-in and `refreshOrders()/refreshTables()` on socket events.
 */

// ───────────── API -> UI mappers (API is camelCase, UI types are the shapes in types/pos.ts) ─────────────

const mapMenuItem = (i: any): MenuItem => ({
  id: i.id,
  categoryId: i.categoryId,
  branchId: i.branchId,
  name: i.name,
  description: i.description ?? undefined,
  price: Number(i.price),
  image: i.image ?? undefined,
  isVeg: !!i.isVeg,
  isAvailable: !!i.isAvailable,
  preparationTime: i.preparationTime ?? 0,
  variants: (i.variants || []).map((v: any) => ({ id: v.id, name: v.name, priceModifier: Number(v.priceModifier) })),
  addons: (i.addons || []).map((a: any) => ({ id: a.id, name: a.name, price: Number(a.price) })),
});

const mapCategory = (c: any): Category => ({
  id: c.id,
  branchId: c.branchId,
  name: c.name,
  description: c.description ?? undefined,
  image: c.image ?? undefined,
  sortOrder: c.sortOrder ?? 0,
  isActive: !!c.isActive,
});

const mapTable = (t: any): Table => ({
  id: t.id,
  branchId: t.branchId,
  number: t.tableNumber,
  capacity: t.capacity,
  floor: t.floor,
  area: t.area,
  status: t.status,
  qrCode: t.qrCode ?? undefined,
  currentOrderId: t.currentOrderId ?? undefined,
  mergedWith: t.mergedWith ?? [],
  positionX: t.positionX ?? undefined,
  positionY: t.positionY ?? undefined,
});

const mapOrderItem = (i: any): OrderItem => ({
  id: i.id,
  orderId: i.orderId,
  menuItemId: i.menuItemId,
  // the API stores a name/price snapshot per line, so no menu lookup is needed
  menuItem: { id: i.menuItemId, name: i.name, price: Number(i.unitPrice), categoryId: '', branchId: '', isVeg: true, isAvailable: true, preparationTime: 0 },
  quantity: i.quantity,
  unitPrice: Number(i.unitPrice),
  total: Number(i.total),
  status: i.status,
  notes: i.notes ?? undefined,
  course: i.course ?? undefined,
  kotPrinted: !!i.kotPrinted,
});

const mapOrder = (o: any): Order => ({
  id: o.id,
  branchId: o.branchId,
  tableId: o.tableId ?? undefined,
  waiterId: o.waiterId ?? undefined,
  customerId: undefined,
  orderNumber: o.orderNumber,
  type: o.orderType,
  status: o.status,
  items: (o.items || []).filter((i: any) => i.status !== 'cancelled' && !i.billedByBillId).map(mapOrderItem),
  subtotal: Number(o.subtotal),
  tax: Number(o.tax),
  serviceCharge: Number(o.serviceCharge),
  discount: Number(o.discount),
  total: Number(o.total),
  notes: o.notes ?? undefined,
  createdAt: new Date(o.createdAt),
  updatedAt: new Date(o.updatedAt),
  isPaid: !!o.isPaid,
});

// ───────────── store ─────────────

interface POSState {
  currentUser: User | null;

  tables: Table[];
  orders: Order[];
  categories: Category[];
  menuItems: MenuItem[];
  loaded: boolean;

  selectedTable: Table | null;
  currentOrder: Order | null;
  cartItems: OrderItem[];

  init: () => Promise<void>;
  refreshMenu: () => Promise<void>;
  refreshTables: () => Promise<void>;
  refreshOrders: () => Promise<void>;

  setCurrentUser: (user: User | null) => void;
  selectTable: (table: Table | null) => void;
  setCurrentOrder: (order: Order | null) => void;

  updateTableStatus: (tableId: string, status: Table['status']) => Promise<void>;
  shiftTable: (fromTableId: string, toTableId: string) => Promise<void>;
  mergeTables: (primaryTableId: string, tableIds: string[]) => Promise<void>;

  addToCart: (item: MenuItem, quantity?: number) => void;
  removeFromCart: (itemId: string) => void;
  updateCartItemQuantity: (itemId: string, quantity: number) => void;
  clearCart: () => void;
  /** Places the cart as an order on the table. Throws with a readable message on failure. */
  createOrder: (tableId: string) => Promise<Order>;
  updateOrderStatus: (orderId: string, status: Order['status']) => Promise<void>;
  updateOrderItemStatus: (orderId: string, itemId: string, status: OrderItem['status']) => Promise<void>;
  setItemAvailability: (menuItemId: string, isAvailable: boolean) => Promise<void>;

  getDashboardStats: () => DashboardStats;
}

export const usePOSStore = create<POSState>((set, get) => ({
  currentUser: null,

  tables: [],
  orders: [],
  categories: [],
  menuItems: [],
  loaded: false,

  selectedTable: null,
  currentOrder: null,
  cartItems: [],

  init: async () => {
    await Promise.all([get().refreshMenu(), get().refreshTables(), get().refreshOrders()]);
    set({ loaded: true });
  },

  refreshMenu: async () => {
    try {
      const [cats, items] = await Promise.all([
        apiClient.get('/menu/categories', { params: { includeInactive: true } }).then((r) => r.data.data),
        apiClient.get('/menu/items').then((r) => r.data.data),
      ]);
      set({ categories: (cats || []).map(mapCategory), menuItems: (items || []).map(mapMenuItem) });
    } catch (e) {
      console.error('Failed to load menu:', errorMessage(e));
    }
  },

  refreshTables: async () => {
    try {
      const tables = await apiClient.tables.getAll();
      set({ tables: (tables || []).map(mapTable) });
    } catch (e) {
      console.error('Failed to load tables:', errorMessage(e));
    }
  },

  refreshOrders: async () => {
    try {
      const orders = await apiClient.orders.getAll({ limit: 200 });
      const mapped = (orders || []).map(mapOrder);
      const cur = get().currentOrder;
      set({ orders: mapped, currentOrder: cur ? (mapped.find((o: Order) => o.id === cur.id) ?? cur) : null });
    } catch (e) {
      console.error('Failed to load orders:', errorMessage(e));
    }
  },

  setCurrentUser: (user) => set({ currentUser: user }),

  selectTable: (table) => {
    const order = table?.currentOrderId ? get().orders.find((o) => o.id === table.currentOrderId) : null;
    set({ selectedTable: table, currentOrder: order ?? null });
  },

  setCurrentOrder: (order) => set({ currentOrder: order }),

  updateTableStatus: async (tableId, status) => {
    await apiClient.tables.updateStatus(tableId, status);
    await get().refreshTables();
  },

  shiftTable: async (fromTableId, toTableId) => {
    await apiClient.tables.shift(fromTableId, toTableId);
    await Promise.all([get().refreshTables(), get().refreshOrders()]);
  },

  mergeTables: async (primaryTableId, tableIds) => {
    await apiClient.tables.merge(primaryTableId, tableIds);
    await get().refreshTables();
  },

  addToCart: (item, quantity = 1) => {
    set((state) => {
      const existing = state.cartItems.find((ci) => ci.menuItemId === item.id);
      if (existing) {
        return {
          cartItems: state.cartItems.map((ci) =>
            ci.menuItemId === item.id ? { ...ci, quantity: ci.quantity + quantity, total: (ci.quantity + quantity) * ci.unitPrice } : ci
          ),
        };
      }
      const newItem: OrderItem = {
        id: `cart-${Date.now()}-${item.id}`,
        orderId: '',
        menuItemId: item.id,
        menuItem: item,
        quantity,
        unitPrice: item.price,
        total: item.price * quantity,
        status: 'pending',
        kotPrinted: false,
      };
      return { cartItems: [...state.cartItems, newItem] };
    });
  },

  removeFromCart: (itemId) => set((state) => ({ cartItems: state.cartItems.filter((ci) => ci.id !== itemId) })),

  updateCartItemQuantity: (itemId, quantity) => {
    if (quantity <= 0) {
      get().removeFromCart(itemId);
      return;
    }
    set((state) => ({
      cartItems: state.cartItems.map((ci) => (ci.id === itemId ? { ...ci, quantity, total: quantity * ci.unitPrice } : ci)),
    }));
  },

  clearCart: () => set({ cartItems: [] }),

  createOrder: async (tableId) => {
    const { cartItems } = get();
    if (cartItems.length === 0) throw new Error('The cart is empty');
    try {
      // The server prices items, applies tax/service charge, prints the KOT and occupies the table.
      // If the table already has an open order the items are appended to it.
      const created = await apiClient.orders.create({
        tableId,
        orderType: 'dine_in',
        items: cartItems.map((ci) => ({ menuItemId: ci.menuItemId, quantity: ci.quantity, notes: ci.notes })),
      });
      const order = mapOrder(created);
      set((state) => ({
        cartItems: [],
        currentOrder: order,
        orders: [order, ...state.orders.filter((o) => o.id !== order.id)],
      }));
      void get().refreshTables();
      return order;
    } catch (e) {
      throw new Error(errorMessage(e, 'Could not place the order'));
    }
  },

  updateOrderStatus: async (orderId, status) => {
    await apiClient.orders.updateStatus(orderId, status);
    await get().refreshOrders();
  },

  updateOrderItemStatus: async (orderId, itemId, status) => {
    await apiClient.orders.updateItem(orderId, itemId, { status });
    await get().refreshOrders();
  },

  setItemAvailability: async (menuItemId, isAvailable) => {
    await apiClient.menu.toggleAvailability(menuItemId, isAvailable);
    set((state) => ({ menuItems: state.menuItems.map((m) => (m.id === menuItemId ? { ...m, isAvailable } : m)) }));
  },

  getDashboardStats: () => {
    const { orders, tables } = get();
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const todayOrders = orders.filter((o) => o.createdAt >= today && o.status !== 'cancelled');
    const activeOrders = orders.filter((o) => ['pending', 'preparing', 'ready'].includes(o.status));
    const occupiedTables = tables.filter((t) => t.status === 'occupied').length;

    const itemCounts: Record<string, { name: string; quantity: number }> = {};
    todayOrders.forEach((order) => {
      order.items.forEach((item) => {
        if (!itemCounts[item.menuItemId]) itemCounts[item.menuItemId] = { name: item.menuItem.name, quantity: 0 };
        itemCounts[item.menuItemId].quantity += item.quantity;
      });
    });
    const topSellingItems = Object.values(itemCounts).sort((a, b) => b.quantity - a.quantity).slice(0, 5);
    const sales = todayOrders.reduce((sum, o) => sum + o.total, 0);

    return {
      todaySales: sales,
      todayOrders: todayOrders.length,
      activeOrders: activeOrders.length,
      occupiedTables,
      totalTables: tables.length,
      avgOrderValue: todayOrders.length > 0 ? sales / todayOrders.length : 0,
      topSellingItems,
      recentOrders: orders.slice(0, 5),
    };
  },
}));
