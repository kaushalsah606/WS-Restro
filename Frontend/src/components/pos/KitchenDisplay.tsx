'use client';

import { useOrders, useTables } from '@/hooks/useDatabase';
import { Clock, ChefHat, Check, AlertCircle, RefreshCw, Printer, Pause, Play } from 'lucide-react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { Loader2 } from 'lucide-react';

// Local type definitions
type DbOrder = {
  id: string;
  status: string;
  is_held?: boolean;
  [key: string]: any;
};

type DbOrderItem = {
  id: string;
  status: string;
  [key: string]: any;
};

type DbMenuItem = {
  id: string;
  name: string;
  [key: string]: any;
};

export function KitchenDisplay() {
  // live from the API; the kitchen room on the socket pushes every KOT / status change
  const { orders: liveOrders, loading: ordersLoading, fetchOrders, updateOrderStatus, updateOrderItemStatus } = useOrders();
  const { tables } = useTables();
  const orders = liveOrders as unknown as DbOrder[];

  const activeOrders = orders.filter(o =>
    ['pending', 'preparing', 'ready'].includes(o.status || '') && !o.is_held
  );

  const heldOrders = orders.filter(o => o.is_held);

  const getTableNumber = (tableId: string | null) => {
    if (!tableId) return 'T/A';
    const table = tables.find(t => t.id === tableId);
    return table ? `T${table.table_number}` : 'T/A';
  };

  const getTimeElapsed = (date: string | null) => {
    if (!date) return 0;
    const minutes = Math.floor((Date.now() - new Date(date).getTime()) / 60000);
    return minutes;
  };

  const getTimeColor = (minutes: number) => {
    if (minutes < 10) return 'text-status-available';
    if (minutes < 20) return 'text-order-pending';
    return 'text-destructive';
  };

  const handleMarkPreparing = (orderId: string) => {
    updateOrderStatus(orderId, 'preparing');
  };

  const handleMarkReady = (orderId: string) => {
    updateOrderStatus(orderId, 'ready');
  };

  const handleMarkItemReady = (itemId: string) => {
    updateOrderItemStatus(itemId, 'ready');
  };

  if (ordersLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="p-6 bg-background min-h-full">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="p-3 rounded-xl gradient-accent">
            <ChefHat className="w-6 h-6 text-accent-foreground" />
          </div>
          <div>
            <h2 className="text-2xl font-bold text-foreground">Kitchen Display</h2>
            <p className="text-muted-foreground">
              {activeOrders.length} active orders
              {heldOrders.length > 0 && ` • ${heldOrders.length} on hold`}
            </p>
          </div>
        </div>
        <Button variant="outline" className="gap-2" onClick={() => fetchOrders()}>
          <RefreshCw className="w-4 h-4" />
          Refresh
        </Button>
      </div>

      {/* Held Orders Alert */}
      {heldOrders.length > 0 && (
        <div className="mb-6 p-4 rounded-xl bg-amber-500/10 border border-amber-500/30">
          <div className="flex items-center gap-2 mb-2">
            <Pause className="w-5 h-5 text-amber-600" />
            <span className="font-semibold text-amber-600">Orders On Hold</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {heldOrders.map(order => (
              <Badge key={order.id} variant="outline" className="bg-amber-500/20 border-amber-500/30">
                {order.order_number} - {getTableNumber(order.table_id)}
              </Badge>
            ))}
          </div>
        </div>
      )}

      {/* Orders Grid */}
      {activeOrders.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
          <ChefHat className="w-16 h-16 mb-4 opacity-50" />
          <h3 className="text-xl font-semibold mb-2">No Active Orders</h3>
          <p>New orders will appear here automatically</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {activeOrders.map(order => {
            const minutes = getTimeElapsed(order.created_at);
            const timeColor = getTimeColor(minutes);
            const orderItems = order.order_items || [];

            return (
              <Card
                key={order.id}
                className={cn(
                  "kot-card border-2 overflow-hidden",
                  order.status === 'pending' && "border-order-pending",
                  order.status === 'preparing' && "border-order-preparing",
                  order.status === 'ready' && "border-order-ready",
                )}
              >
                <CardHeader className={cn(
                  "py-3 px-4",
                  order.status === 'pending' && "bg-order-pending/10",
                  order.status === 'preparing' && "bg-order-preparing/10",
                  order.status === 'ready' && "bg-order-ready/10",
                )}>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className={cn(
                        "w-12 h-12 rounded-xl flex items-center justify-center font-bold text-white",
                        order.status === 'pending' && "bg-order-pending",
                        order.status === 'preparing' && "bg-order-preparing",
                        order.status === 'ready' && "bg-order-ready",
                      )}>
                        {getTableNumber(order.table_id)}
                      </div>
                      <div>
                        <p className="font-bold text-foreground">{order.order_number}</p>
                        <Badge
                          variant="outline"
                          className="capitalize"
                        >
                          {order.status}
                        </Badge>
                      </div>
                    </div>
                    <div className={cn("flex items-center gap-1 font-mono font-bold", timeColor)}>
                      <Clock className="w-4 h-4" />
                      {minutes}m
                    </div>
                  </div>
                </CardHeader>

                <CardContent className="p-4">
                  <div className="space-y-3">
                    {orderItems.map(item => (
                      <div
                        key={item.id}
                        className={cn(
                          "flex items-center justify-between p-3 rounded-lg transition-colors",
                          item.status === 'ready'
                            ? "bg-order-ready/10 line-through opacity-60"
                            : "bg-muted/50"
                        )}
                      >
                        <div className="flex items-center gap-3">
                          <span className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center font-bold text-primary">
                            {item.quantity}
                          </span>
                          <div>
                            <p className={cn(
                              "font-medium",
                              item.status === 'ready' ? "text-muted-foreground" : "text-foreground"
                            )}>
                              {item.menu_items?.name || 'Unknown Item'}
                            </p>
                            {item.notes && (
                              <p className="text-sm text-order-pending flex items-center gap-1">
                                <AlertCircle className="w-3 h-3" />
                                {item.notes}
                              </p>
                            )}
                            {item.course && (
                              <Badge variant="outline" className="text-xs mt-1 capitalize">
                                {item.course}
                              </Badge>
                            )}
                          </div>
                        </div>
                        {item.status !== 'ready' && item.status !== 'cancelled' && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="text-status-available hover:bg-status-available/10"
                            onClick={() => handleMarkItemReady(item.id)}
                          >
                            <Check className="w-5 h-5" />
                          </Button>
                        )}
                      </div>
                    ))}
                  </div>

                  {/* Actions */}
                  <div className="flex gap-2 mt-4 pt-4 border-t border-border">
                    {order.status === 'pending' && (
                      <Button
                        className="flex-1 gap-2 bg-order-preparing hover:bg-order-preparing/90"
                        onClick={() => handleMarkPreparing(order.id)}
                      >
                        <ChefHat className="w-4 h-4" />
                        Start Preparing
                      </Button>
                    )}
                    {order.status === 'preparing' && (
                      <Button
                        className="flex-1 gap-2 bg-order-ready hover:bg-order-ready/90"
                        onClick={() => handleMarkReady(order.id)}
                      >
                        <Check className="w-4 h-4" />
                        Mark Ready
                      </Button>
                    )}
                    {order.status === 'ready' && (
                      <Button
                        variant="outline"
                        className="flex-1 gap-2 text-status-available border-status-available"
                      >
                        <Check className="w-4 h-4" />
                        Ready to Serve
                      </Button>
                    )}
                    <Button variant="ghost" size="icon">
                      <Printer className="w-4 h-4" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
