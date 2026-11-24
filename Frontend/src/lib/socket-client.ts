import { io, Socket } from 'socket.io-client';

const SOCKET_URL = process.env.NEXT_PUBLIC_SOCKET_URL || 'http://localhost:5000';

class SocketClient {
  socket: Socket | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  // rooms to (re)join after every (re)connect – server-side rooms are lost when the socket drops
  private rooms = new Map<string, number>();

  private join(event: string, id: string) {
    const key = event + '|' + id;
    const n = this.rooms.get(key) ?? 0;
    this.rooms.set(key, n + 1);
    if (n === 0) this.socket?.emit(event, id);
  }

  private leave(joinEvent: string, leaveEvent: string, id: string) {
    const key = joinEvent + '|' + id;
    const n = (this.rooms.get(key) ?? 0) - 1;
    if (n > 0) {
      this.rooms.set(key, n);
      return;
    }
    this.rooms.delete(key);
    this.socket?.emit(leaveEvent, id);
  }

  connect(token?: string) {
    if (this.socket?.connected) {
      return;
    }

    const authToken = token || localStorage.getItem('accessToken');

    if (this.socket) {
      // existing but disconnected: reconnect with the latest token
      this.socket.auth = authToken ? { token: authToken } : {};
      this.socket.connect();
      return;
    }

    this.socket = io(SOCKET_URL, {
      auth: authToken ? {
        token: authToken,
      } : undefined,
      transports: ['websocket'],
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      reconnectionAttempts: this.maxReconnectAttempts,
    });

    this.setupEventListeners();
  }

  disconnect() {
    this.rooms.clear();
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }
  }

  private setupEventListeners() {
    if (!this.socket) return;

    this.socket.on('connect', () => {
      console.log('✅ Socket connected:', this.socket?.id);
      this.reconnectAttempts = 0;
      this.rooms.forEach((_n, key) => {
        const [event, id] = key.split('|');
        this.socket?.emit(event, id);
      });
    });

    this.socket.on('disconnect', (reason) => {
      console.log('❌ Socket disconnected:', reason);
    });

    this.socket.on('connect_error', (error) => {
      console.error('Socket connection error:', error);
      this.reconnectAttempts++;

      if (this.reconnectAttempts >= this.maxReconnectAttempts) {
        console.error('Max reconnection attempts reached');
        this.disconnect();
      }
    });

    this.socket.on('pong', () => {
      console.log('🏓 Pong received');
    });
  }

  // Room management
  joinBranch(branchId: string) {
    this.join('join:branch', branchId);
  }

  joinKitchen(branchId: string) {
    this.join('join:kitchen', branchId);
  }

  joinTable(tableId: string) {
    this.join('join:table', tableId);
  }

  joinOrder(orderId: string) {
    this.join('join:order', orderId);
  }

  leaveBranch(branchId: string) {
    this.leave('join:branch', 'leave:branch', branchId);
  }

  leaveKitchen(branchId: string) {
    this.leave('join:kitchen', 'leave:kitchen', branchId);
  }

  leaveTable(tableId: string) {
    this.leave('join:table', 'leave:table', tableId);
  }

  leaveOrder(orderId: string) {
    this.leave('join:order', 'leave:order', orderId);
  }

  // Event listeners
  onOrderCreated(callback: (order: any) => void) {
    this.socket?.on('order:created', callback);
    return () => this.socket?.off('order:created', callback);
  }

  onNewOrder(callback: (order: any) => void) {
    this.socket?.on('order:new', callback);
    return () => this.socket?.off('order:new', callback);
  }

  onOrderUpdated(callback: (order: any) => void) {
    this.socket?.on('order:updated', callback);
    return () => this.socket?.off('order:updated', callback);
  }

  onOrderDeleted(callback: (orderId: string) => void) {
    this.socket?.on('order:deleted', callback);
    return () => this.socket?.off('order:deleted', callback);
  }

  onOrderStatusChanged(callback: (data: any) => void) {
    this.socket?.on('order:status:changed', callback);
    return () => this.socket?.off('order:status:changed', callback);
  }

  onTableUpdated(callback: (table: any) => void) {
    this.socket?.on('table:updated', callback);
    return () => this.socket?.off('table:updated', callback);
  }

  onTableStatusChanged(callback: (data: any) => void) {
    this.socket?.on('table:status:changed', callback);
    return () => this.socket?.off('table:status:changed', callback);
  }

  onKOTCreated(callback: (kot: any) => void) {
    this.socket?.on('kot:created', callback);
    return () => this.socket?.off('kot:created', callback);
  }

  onNewKOT(callback: (kot: any) => void) {
    this.socket?.on('kot:new', callback);
    return () => this.socket?.off('kot:new', callback);
  }

  onKOTUpdated(callback: (kot: any) => void) {
    this.socket?.on('kot:updated', callback);
    return () => this.socket?.off('kot:updated', callback);
  }

  onBillCreated(callback: (bill: any) => void) {
    this.socket?.on('bill:created', callback);
    return () => this.socket?.off('bill:created', callback);
  }

  onBillUpdated(callback: (bill: any) => void) {
    this.socket?.on('bill:updated', callback);
    return () => this.socket?.off('bill:updated', callback);
  }

  onMenuUpdated(callback: (menuItem: any) => void) {
    this.socket?.on('menu:updated', callback);
    return () => this.socket?.off('menu:updated', callback);
  }

  onMenuAvailabilityChanged(callback: (data: any) => void) {
    this.socket?.on('menu:availability:changed', callback);
    return () => this.socket?.off('menu:availability:changed', callback);
  }

  onReservationUpdated(callback: (reservation: any) => void) {
    this.socket?.on('reservation:updated', callback);
    this.socket?.on('reservation:created', callback);
    return () => {
      this.socket?.off('reservation:updated', callback);
      this.socket?.off('reservation:created', callback);
    };
  }

  onNotification(callback: (notification: any) => void) {
    this.socket?.on('notification', callback);
    return () => this.socket?.off('notification', callback);
  }

  // Remove event listeners
  off(event: string, callback?: Function) {
    if (callback) {
      this.socket?.off(event, callback as any);
    } else {
      this.socket?.off(event);
    }
  }

  // Ping server
  ping() {
    this.socket?.emit('ping');
  }

  // Get connection status
  isConnected(): boolean {
    return this.socket?.connected || false;
  }

  getSocket(): Socket | null {
    return this.socket;
  }
}

export const socketClient = new SocketClient();
export default socketClient;
