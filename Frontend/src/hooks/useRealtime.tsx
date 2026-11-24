'use client';

import { useEffect, useRef } from 'react';
import { useBranchId } from '@/hooks/useBranchId';
import { socketClient } from '@/lib/socket-client';

/**
 * Hook for subscribing to realtime events using Socket.IO
 * Socket.IO realtime subscriptions
 */

// Hook for subscribing to order updates
export function useOrdersRealtime(branchId: string | null, onUpdate: () => void) {
  useEffect(() => {
    if (!branchId) return;

    socketClient.connect();
    socketClient.joinBranch(branchId);

    const handleOrderEvent = (order: any) => {
      if (order.branchId === branchId) {
        console.log('Orders updated');
        onUpdate();
      }
    };

    socketClient.onOrderCreated(handleOrderEvent);
    socketClient.onOrderUpdated(handleOrderEvent);
    socketClient.onOrderDeleted(handleOrderEvent);

    return () => {
      socketClient.leaveBranch(branchId);
    };
  }, [branchId, onUpdate]);
}

// Hook for subscribing to table updates
export function useTablesRealtime(branchId: string | null, onUpdate: () => void) {
  useEffect(() => {
    if (!branchId) return;

    socketClient.connect();
    socketClient.joinBranch(branchId);

    const handleTableUpdated = (table: any) => {
      if (table.branchId === branchId) {
        console.log('Tables updated');
        onUpdate();
      }
    };

    socketClient.onTableUpdated(handleTableUpdated);

    return () => {
      socketClient.leaveBranch(branchId);
    };
  }, [branchId, onUpdate]);
}

// Hook for kitchen display
export function useKitchenRealtime(branchId: string | null, onUpdate: () => void) {
  useEffect(() => {
    if (!branchId) return;

    socketClient.connect();
    socketClient.joinBranch(branchId);

    const handleKOTEvent = (kot: any) => {
      if (kot.branchId === branchId) {
        console.log('KOTs updated');
        onUpdate();
      }
    };

    socketClient.onKOTCreated(handleKOTEvent);
    socketClient.onKOTUpdated(handleKOTEvent);

    return () => {
      socketClient.leaveBranch(branchId);
    };
  }, [branchId, onUpdate]);
}

/**
 * Call `onEvent` whenever any of the given Socket.IO events arrives for the current branch.
 * e.g. useSocketEvents(['inventory:updated'], fetchInventory)
 */
export function useSocketEvents(events: string[], onEvent: () => void) {
  const branchId = useBranchId();
  const handler = useRef(onEvent);
  handler.current = onEvent;
  const key = events.join(',');

  useEffect(() => {
    if (!branchId) return;
    socketClient.connect();
    socketClient.joinBranch(branchId);
    const fn = () => handler.current();
    const names = key.split(',');
    names.forEach((e) => socketClient.socket?.on(e, fn));
    return () => {
      names.forEach((e) => socketClient.socket?.off(e, fn));
    };
  }, [branchId, key]);
}
