'use client';

import { useState } from 'react';
import { X, Plus, Minus, Trash2, Send, Printer, Receipt, ChefHat } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { usePOSStore } from '@/stores/posStore';
import { cn } from '@/lib/utils';
import type { Table, MenuItem, Category } from '@/types/pos';
import { toast } from '@/hooks/use-toast';

interface OrderPanelProps {
  table: Table | null;
  onClose: () => void;
}

export function OrderPanel({ table, onClose }: OrderPanelProps) {
  const [activeCategory, setActiveCategory] = useState<string>('all');

  const categories = usePOSStore(state => state.categories);
  const menuItems = usePOSStore(state => state.menuItems);
  const cartItems = usePOSStore(state => state.cartItems);
  // the table's open (unpaid, not finished) order, straight from the synced order list
  const currentOrder = usePOSStore(state =>
    table
      ? state.orders.find(o => o.tableId === table.id && !o.isPaid && ['pending', 'preparing', 'ready'].includes(o.status)) ?? null
      : null
  );
  const addToCart = usePOSStore(state => state.addToCart);
  const removeFromCart = usePOSStore(state => state.removeFromCart);
  const updateCartItemQuantity = usePOSStore(state => state.updateCartItemQuantity);
  const clearCart = usePOSStore(state => state.clearCart);
  const createOrder = usePOSStore(state => state.createOrder);

  const filteredItems = activeCategory === 'all'
    ? menuItems
    : menuItems.filter(item => item.categoryId === activeCategory);

  const cartTotal = cartItems.reduce((sum, item) => sum + item.total, 0);
  const tax = cartTotal * 0.05;
  const serviceCharge = cartTotal * 0.05;
  const grandTotal = cartTotal + tax + serviceCharge;

  const [placing, setPlacing] = useState(false);

  const handlePlaceOrder = async () => {
    if (!table || cartItems.length === 0 || placing) return;

    setPlacing(true);
    try {
      const order = await createOrder(table.id);
      toast({
        title: "Order Placed!",
        description: `${order.orderNumber} – KOT sent to the kitchen.`,
      });
    } catch (error) {
      toast({
        title: "Could not place order",
        description: error instanceof Error ? error.message : 'Please try again.',
        variant: "destructive",
      });
    } finally {
      setPlacing(false);
    }
  };

  // The KOT is generated and printed automatically when the order is placed.
  const handleSendToKitchen = () => handlePlaceOrder();

  // Show current order items if exists, otherwise show cart
  const displayItems = currentOrder ? currentOrder.items : cartItems;

  return (
    <div className="fixed right-0 top-16 bottom-0 w-full lg:w-[400px] bg-card border-l border-border shadow-2xl z-30 flex flex-col animate-slide-in-right">
      {/* Header */}
      <div className="p-4 border-b border-border flex items-center justify-between">
        <div>
          <h2 className="font-bold text-lg text-foreground">
            {table ? `Table ${table.number}` : 'New Order'}
          </h2>
          <p className="text-sm text-muted-foreground">
            {currentOrder ? `Order ${currentOrder.orderNumber}` : 'Select items to add'}
          </p>
        </div>
        <Button variant="ghost" size="icon" onClick={onClose}>
          <X className="w-5 h-5" />
        </Button>
      </div>

      {/* Menu Selection */}
      {!currentOrder && (
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Category Tabs */}
          <div className="p-4 border-b border-border">
            <ScrollArea className="w-full">
              <div className="flex gap-2">
                <Button
                  variant={activeCategory === 'all' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setActiveCategory('all')}
                  className="shrink-0"
                >
                  All
                </Button>
                {categories.map(cat => (
                  <Button
                    key={cat.id}
                    variant={activeCategory === cat.id ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setActiveCategory(cat.id)}
                    className="shrink-0"
                  >
                    {cat.name}
                  </Button>
                ))}
              </div>
            </ScrollArea>
          </div>

          {/* Menu Items */}
          <ScrollArea className="flex-1 p-4">
            <div className="grid grid-cols-2 gap-3">
              {filteredItems.map(item => (
                <button
                  key={item.id}
                  onClick={() => addToCart(item)}
                  disabled={!item.isAvailable}
                  className={cn(
                    "p-3 rounded-xl border text-left transition-all duration-200",
                    "hover:border-primary hover:shadow-md",
                    !item.isAvailable && "opacity-50 cursor-not-allowed",
                    item.isAvailable && "border-border hover:bg-muted/50"
                  )}
                >
                  <div className="flex items-start gap-2 mb-2">
                    <div className={cn(
                      "w-3 h-3 rounded-full border-2 shrink-0 mt-1",
                      item.isVeg
                        ? "border-status-available bg-status-available/20"
                        : "border-destructive bg-destructive/20"
                    )} />
                    <span className="font-medium text-sm text-foreground line-clamp-2">
                      {item.name}
                    </span>
                  </div>
                  <p className="font-bold text-foreground">₹{item.price}</p>
                </button>
              ))}
            </div>
          </ScrollArea>
        </div>
      )}

      {/* Cart / Order Items */}
      <div className={cn(
        "border-t border-border",
        currentOrder ? "flex-1 flex flex-col" : ""
      )}>
        <div className="p-4 border-b border-border flex items-center justify-between">
          <h3 className="font-semibold text-foreground">
            {currentOrder ? 'Order Items' : 'Cart'} ({displayItems.length})
          </h3>
          {!currentOrder && cartItems.length > 0 && (
            <Button variant="ghost" size="sm" onClick={clearCart} className="text-destructive">
              Clear All
            </Button>
          )}
        </div>

        <ScrollArea className={cn(currentOrder ? "flex-1" : "max-h-48")}>
          <div className="p-4 space-y-3">
            {displayItems.length === 0 ? (
              <p className="text-center text-muted-foreground py-4">
                No items added yet
              </p>
            ) : (
              displayItems.map(item => (
                <div
                  key={item.id}
                  className="flex items-center gap-3 p-3 rounded-xl bg-muted/50 order-item-enter"
                >
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-foreground truncate">
                      {item.menuItem.name}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      ₹{item.unitPrice} × {item.quantity}
                    </p>
                  </div>

                  {currentOrder ? (
                    <Badge
                      variant="outline"
                      className={cn(
                        "capitalize shrink-0",
                        item.status === 'pending' && "bg-order-pending/10 text-order-pending border-order-pending/30",
                        item.status === 'preparing' && "bg-order-preparing/10 text-order-preparing border-order-preparing/30",
                        item.status === 'ready' && "bg-order-ready/10 text-order-ready border-order-ready/30",
                      )}
                    >
                      {item.status}
                    </Badge>
                  ) : (
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => updateCartItemQuantity(item.id, item.quantity - 1)}
                      >
                        <Minus className="w-3 h-3" />
                      </Button>
                      <span className="w-6 text-center font-medium">{item.quantity}</span>
                      <Button
                        variant="outline"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => updateCartItemQuantity(item.id, item.quantity + 1)}
                      >
                        <Plus className="w-3 h-3" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-destructive"
                        onClick={() => removeFromCart(item.id)}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  )}

                  <p className="font-bold text-foreground shrink-0">
                    ₹{item.total.toFixed(0)}
                  </p>
                </div>
              ))
            )}
          </div>
        </ScrollArea>
      </div>

      {/* Totals & Actions */}
      <div className="p-4 border-t border-border bg-muted/30">
        <div className="space-y-2 mb-4 text-sm">
          <div className="flex justify-between text-muted-foreground">
            <span>Subtotal</span>
            <span>₹{(currentOrder?.subtotal || cartTotal).toFixed(0)}</span>
          </div>
          <div className="flex justify-between text-muted-foreground">
            <span>Tax (5%)</span>
            <span>₹{(currentOrder?.tax || tax).toFixed(0)}</span>
          </div>
          <div className="flex justify-between text-muted-foreground">
            <span>Service (10%)</span>
            <span>₹{(currentOrder?.serviceCharge || serviceCharge).toFixed(0)}</span>
          </div>
          <div className="flex justify-between font-bold text-lg text-foreground pt-2 border-t border-border">
            <span>Total</span>
            <span>₹{(currentOrder?.total || grandTotal).toFixed(0)}</span>
          </div>
        </div>

        {currentOrder ? (
          <div className="flex gap-2">
            <Button variant="outline" className="flex-1 gap-2">
              <Printer className="w-4 h-4" />
              Print KOT
            </Button>
            <Button className="flex-1 gap-2 gradient-primary text-primary-foreground">
              <Receipt className="w-4 h-4" />
              Generate Bill
            </Button>
          </div>
        ) : (
          <div className="flex gap-2">
            <Button
              variant="outline"
              className="flex-1 gap-2"
              onClick={handleSendToKitchen}
              disabled={cartItems.length === 0}
            >
              <ChefHat className="w-4 h-4" />
              Send KOT
            </Button>
            <Button
              className="flex-1 gap-2 gradient-primary text-primary-foreground"
              onClick={handlePlaceOrder}
              disabled={cartItems.length === 0 || !table || placing}
            >
              <Send className="w-4 h-4" />
              Place Order
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
