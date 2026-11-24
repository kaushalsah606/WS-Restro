// Core Types for Restaurant POS System

export type UserRole = 'super_admin' | 'branch_manager' | 'cashier' | 'waiter' | 'kitchen_staff' | 'customer';

export type TableStatus = 'available' | 'occupied' | 'reserved' | 'cleaning';

export type OrderStatus = 'pending' | 'preparing' | 'ready' | 'served' | 'cancelled';

export type OrderType = 'dine_in' | 'takeaway' | 'delivery';

export type PaymentMethod = 'cash' | 'card' | 'upi' | 'wallet' | 'mixed';

export type PaymentStatus = 'pending' | 'partial' | 'completed' | 'refunded';

export interface User {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  branchId?: string;
  restaurantId?: string;
  avatar?: string;
  isActive: boolean;
  createdAt: Date;
}

export interface Restaurant {
  id: string;
  name: string;
  logo?: string;
  address: string;
  phone: string;
  email: string;
  currency: string;
  taxRate: number;
  serviceCharge: number;
  isActive: boolean;
  createdAt: Date;
}

export interface Branch {
  id: string;
  restaurantId: string;
  name: string;
  address: string;
  phone: string;
  isActive: boolean;
  openingTime: string;
  closingTime: string;
  createdAt: Date;
}

export interface Table {
  id: string;
  branchId: string;
  number: string;
  capacity: number;
  floor: string;
  area: string;
  status: TableStatus;
  qrCode?: string;
  currentOrderId?: string;
  mergedWith?: string[];
  positionX?: number;
  positionY?: number;
}

export interface Category {
  id: string;
  branchId: string;
  name: string;
  description?: string;
  image?: string;
  sortOrder: number;
  isActive: boolean;
}

export interface MenuItem {
  id: string;
  categoryId: string;
  branchId: string;
  name: string;
  description?: string;
  price: number;
  image?: string;
  isVeg: boolean;
  isAvailable: boolean;
  preparationTime: number; // in minutes
  variants?: MenuVariant[];
  addons?: MenuAddon[];
}

export interface MenuVariant {
  id: string;
  name: string;
  priceModifier: number;
}

export interface MenuAddon {
  id: string;
  name: string;
  price: number;
}

export interface Order {
  id: string;
  branchId: string;
  tableId?: string;
  waiterId?: string;
  customerId?: string;
  orderNumber: string;
  type: OrderType;
  status: OrderStatus;
  items: OrderItem[];
  subtotal: number;
  tax: number;
  serviceCharge: number;
  discount: number;
  total: number;
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
  /** true once a completed bill settled this order */
  isPaid?: boolean;
}

export interface OrderItem {
  id: string;
  orderId: string;
  menuItemId: string;
  menuItem: MenuItem;
  quantity: number;
  unitPrice: number;
  total: number;
  status: OrderStatus;
  notes?: string;
  variant?: MenuVariant;
  addons?: MenuAddon[];
  course?: 'starter' | 'main' | 'dessert';
  kotPrinted: boolean;
}

export interface KOT {
  id: string;
  orderId: string;
  orderNumber: string;
  tableNumber?: string;
  items: OrderItem[];
  waiterName?: string;
  printedAt: Date;
  kitchenId: string;
  status: 'printed' | 'acknowledged' | 'completed';
}

export interface Bill {
  id: string;
  orderId: string;
  billNumber: string;
  subtotal: number;
  tax: number;
  serviceCharge: number;
  discount: number;
  total: number;
  payments: Payment[];
  status: PaymentStatus;
  generatedAt: Date;
  paidAt?: Date;
}

export interface Payment {
  id: string;
  billId: string;
  method: PaymentMethod;
  amount: number;
  reference?: string;
  createdAt: Date;
}

export interface DashboardStats {
  todaySales: number;
  todayOrders: number;
  activeOrders: number;
  occupiedTables: number;
  totalTables: number;
  avgOrderValue: number;
  topSellingItems: { name: string; quantity: number }[];
  recentOrders: Order[];
}
