'use client';

import { useEffect, useCallback, useRef, useState } from 'react';
import { toast } from '@/hooks/use-toast';
import { socketClient } from '@/lib/socket-client';
import {
  playSound,
  getOrderEventSound,
  getKOTEventSound,
  getBillEventSound
} from '@/utils/notificationSounds';
import { useBranchId } from '@/hooks/useBranchId';

export interface RealtimeEvent {
  type: 'order' | 'table' | 'kot' | 'bill' | 'reservation' | 'menu';
  action: 'created' | 'updated' | 'deleted';
  data: any;
}

interface UseBranchRealtimeOptions {
  onOrderUpdate?: (event: RealtimeEvent) => void;
  onTableUpdate?: (event: RealtimeEvent) => void;
  onKOTUpdate?: (event: RealtimeEvent) => void;
  onBillUpdate?: (event: RealtimeEvent) => void;
  onReservationUpdate?: (event: RealtimeEvent) => void;
  onMenuUpdate?: (event: RealtimeEvent) => void;
  showNotifications?: boolean;
  enableSounds?: boolean;
}

export function useBranchRealtime({
  onOrderUpdate,
  onTableUpdate,
  onKOTUpdate,
  onBillUpdate,
  onReservationUpdate,
  onMenuUpdate,
  showNotifications = true,
  enableSounds = true
}: UseBranchRealtimeOptions) {
  const [isConnected, setIsConnected] = useState(false);
  const [lastEvent, setLastEvent] = useState<RealtimeEvent | null>(null);

  const playSoundForEvent = useCallback(async (event: RealtimeEvent) => {
    if (!enableSounds) return;

    let soundType = null;
    const dbEvent = ({ created: 'INSERT', updated: 'UPDATE', deleted: 'DELETE' } as const)[event.action];

    switch (event.type) {
      case 'order':
        soundType = getOrderEventSound(dbEvent, event.data?.status);
        break;
      case 'kot':
        soundType = getKOTEventSound(dbEvent);
        break;
      case 'bill':
        soundType = getBillEventSound(dbEvent, event.data?.status);
        break;
    }

    if (soundType) {
      await playSound(soundType);
    }
  }, [enableSounds]);

  const showNotification = useCallback((event: RealtimeEvent) => {
    if (!showNotifications) return;

    let title = '';
    let description = '';

    switch (event.type) {
      case 'order':
        title = event.action === 'created' ? 'New Order' :
                event.action === 'updated' ? 'Order Updated' : 'Order Deleted';
        description = `Order #${event.data?.orderNumber || event.data?.id?.substring(0, 8)} - ${event.data?.status || ''}`;
        break;

      case 'table':
        title = event.action === 'created' ? 'New Table' :
                event.action === 'updated' ? 'Table Updated' : 'Table Deleted';
        description = `Table ${event.data?.tableNumber} - ${event.data?.status || ''}`;
        break;

      case 'kot':
        title = event.action === 'created' ? 'New KOT' :
                event.action === 'updated' ? 'KOT Updated' : 'KOT Deleted';
        description = `KOT #${event.data?.kotNumber} - ${event.data?.status || ''}`;
        break;

      case 'bill':
        title = event.action === 'created' ? 'New Bill' :
                event.action === 'updated' ? 'Bill Updated' : 'Bill Deleted';
        description = `Bill #${event.data?.billNumber} - ${event.data?.status || ''}`;
        break;

      case 'reservation':
        title = event.action === 'created' ? 'New Reservation' :
                event.action === 'updated' ? 'Reservation Updated' : 'Reservation Cancelled';
        description = `${event.data?.customerName || 'Guest'} - ${event.data?.guestCount || 0} guests`;
        break;

      case 'menu':
        title = event.action === 'created' ? 'Menu Item Added' :
                event.action === 'updated' ? 'Menu Updated' : 'Menu Item Removed';
        description = event.data?.name || 'Menu change';
        break;
    }

    if (title) {
      toast({
        title,
        description,
        duration: 3000,
      });
    }
  }, [showNotifications]);

  const handleEvent = useCallback((type: RealtimeEvent['type'], action: RealtimeEvent['action'], data: any) => {
    const event: RealtimeEvent = { type, action, data };
    setLastEvent(event);

    // Play sound for event
    playSoundForEvent(event);

    // Show notification
    showNotification(event);

    // Call specific handlers
    switch (type) {
      case 'order':
        onOrderUpdate?.(event);
        break;
      case 'table':
        onTableUpdate?.(event);
        break;
      case 'kot':
        onKOTUpdate?.(event);
        break;
      case 'bill':
        onBillUpdate?.(event);
        break;
      case 'reservation':
        onReservationUpdate?.(event);
        break;
      case 'menu':
        onMenuUpdate?.(event);
        break;
    }
  }, [onOrderUpdate, onTableUpdate, onKOTUpdate, onBillUpdate, onReservationUpdate, onMenuUpdate, playSoundForEvent, showNotification]);

  const branchId = useBranchId();

  // Always call the latest handler without re-subscribing on every render
  // (callers pass inline functions, which used to re-register all socket listeners each render).
  const handleEventRef = useRef(handleEvent);
  handleEventRef.current = handleEvent;

  useEffect(() => {
    if (!branchId) return;
    const emit = (type: RealtimeEvent['type'], action: RealtimeEvent['action'], data: any) => handleEventRef.current(type, action, data);

    // Connect to Socket.IO server
    socketClient.connect();

    // Join branch room
    socketClient.joinBranch(branchId);

    // Set up event listeners (each returns its unsubscribe)
    const unsubs = [
      socketClient.onOrderCreated((order) => emit('order', 'created', order)),
      socketClient.onOrderUpdated((order) => emit('order', 'updated', order)),
      socketClient.onOrderDeleted((orderId) => emit('order', 'deleted', { id: orderId })),
      socketClient.onTableUpdated((table) => emit('table', 'updated', table)),
      socketClient.onKOTCreated((kot) => emit('kot', 'created', kot)),
      socketClient.onKOTUpdated((kot) => emit('kot', 'updated', kot)),
      socketClient.onBillCreated((bill) => emit('bill', 'created', bill)),
      socketClient.onBillUpdated((bill) => emit('bill', 'updated', bill)),
      socketClient.onMenuUpdated((menu) => emit('menu', 'updated', menu)),
      socketClient.onReservationUpdated((r: any) => emit('reservation', 'updated', r)),
    ];

    // Listen for connection status
    const handleConnect = () => {
      setIsConnected(true);
      console.log('Socket.IO connected');
    };

    const handleDisconnect = () => {
      setIsConnected(false);
      console.log('Socket.IO disconnected');
    };

    socketClient.socket?.on('connect', handleConnect);
    socketClient.socket?.on('disconnect', handleDisconnect);

    // Check initial connection status
    if (socketClient.socket?.connected) {
      setIsConnected(true);
    }

    // Cleanup
    return () => {
      unsubs.forEach((u) => u?.());
      socketClient.leaveBranch(branchId);
      socketClient.socket?.off('connect', handleConnect);
      socketClient.socket?.off('disconnect', handleDisconnect);
    };
  }, [branchId]);

  return {
    isConnected,
    lastEvent,
  };
}

// Waiter-specific realtime notifications hook
export function useWaiterRealtimeNotifications(onRefresh?: () => void) {
  return useBranchRealtime({
    showNotifications: true,
    enableSounds: true,
    onOrderUpdate: () => onRefresh?.(),
    onTableUpdate: () => onRefresh?.(),
  });
}
