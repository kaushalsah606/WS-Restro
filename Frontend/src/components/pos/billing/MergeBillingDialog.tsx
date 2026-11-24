'use client';

import { useState, useMemo } from 'react';
import {
  Combine,
  Check,
  Loader2,
  CreditCard,
  Banknote,
  Smartphone,
  Wallet,
  Trash2,
  Plus
} from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import { apiClient, errorMessage } from '@/lib/api-client';
import { toast } from '@/hooks/use-toast';
import type { PaymentMethod } from '@/types/pos';

interface OrderItem {
  id: string;
  quantity: number;
  unit_price: number;
  total: number;
  menu_item: {
    id: string;
    name: string;
  };
}

interface Order {
  id: string;
  order_number: string;
  table_id: string | null;
  subtotal: number;
  tax: number;
  service_charge: number;
  discount: number;
  total: number;
  items: OrderItem[];
}

interface MergeBillingDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orders: Order[];
  onComplete: () => void;
}

const paymentMethods: { id: PaymentMethod; label: string; icon: React.ElementType }[] = [
  { id: 'cash', label: 'Cash', icon: Banknote },
  { id: 'card', label: 'Card', icon: CreditCard },
  { id: 'upi', label: 'UPI', icon: Smartphone },
  { id: 'wallet', label: 'Wallet', icon: Wallet },
];

export function MergeBillingDialog({ open, onOpenChange, orders, onComplete }: MergeBillingDialogProps) {
  const [selectedOrderIds, setSelectedOrderIds] = useState<string[]>([]);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('cash');
  const [isProcessing, setIsProcessing] = useState(false);

  // Calculate merged totals
  const mergedTotals = useMemo(() => {
    const selected = orders.filter(o => selectedOrderIds.includes(o.id));
    
    return selected.reduce((acc, order) => ({
      subtotal: acc.subtotal + (order.subtotal || 0),
      tax: acc.tax + (order.tax || 0),
      serviceCharge: acc.serviceCharge + (order.service_charge || 0),
      discount: acc.discount + (order.discount || 0),
      total: acc.total + (order.total || 0),
      itemCount: acc.itemCount + order.items.length,
    }), { subtotal: 0, tax: 0, serviceCharge: 0, discount: 0, total: 0, itemCount: 0 });
  }, [orders, selectedOrderIds]);

  const toggleOrder = (orderId: string) => {
    setSelectedOrderIds(prev => 
      prev.includes(orderId) 
        ? prev.filter(id => id !== orderId)
        : [...prev, orderId]
    );
  };

  const selectAll = () => {
    setSelectedOrderIds(orders.map(o => o.id));
  };

  const clearSelection = () => {
    setSelectedOrderIds([]);
  };

  const handleProcessMergedBill = async () => {
    if (selectedOrderIds.length < 2) {
      toast({
        title: "Select at least 2 orders",
        description: "Merged billing requires multiple orders",
        variant: "destructive",
      });
      return;
    }

    setIsProcessing(true);
    try {
      // server builds one bill for all orders, records the payment and settles orders + tables atomically
      const bill = await apiClient.snake.post('/billing/merge', {
        order_ids: selectedOrderIds,
        method: paymentMethod,
      });
      const billNumber = bill.bill_number;

      toast({
        title: "Merged bill processed!",
        description: `Bill ${billNumber} - ₹${mergedTotals.total.toFixed(0)} for ${selectedOrderIds.length} orders`,
      });

      setSelectedOrderIds([]);
      onComplete();
      onOpenChange(false);
    } catch (error) {
      console.error('Error processing merged bill:', error);
      toast({
        title: "Error",
        description: errorMessage(error, "Failed to process merged bill"),
        variant: "destructive",
      });
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Combine className="w-5 h-5" />
            Merge Bills
          </DialogTitle>
        </DialogHeader>

        <div className="py-4 space-y-4">
          {/* Quick Actions */}
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={selectAll}>
              <Plus className="w-4 h-4 mr-1" />
              Select All
            </Button>
            <Button variant="outline" size="sm" onClick={clearSelection}>
              <Trash2 className="w-4 h-4 mr-1" />
              Clear
            </Button>
          </div>

          {/* Order Selection */}
          <ScrollArea className="h-[250px] border rounded-lg p-3">
            <div className="space-y-2">
              {orders.map(order => {
                const isSelected = selectedOrderIds.includes(order.id);

                return (
                  <div
                    key={order.id}
                    onClick={() => toggleOrder(order.id)}
                    className={cn(
                      "p-3 rounded-lg border cursor-pointer transition-colors",
                      isSelected 
                        ? "bg-primary/5 border-primary/30" 
                        : "hover:bg-muted/50"
                    )}
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{order.order_number}</span>
                          {isSelected && (
                            <Badge variant="secondary" className="text-xs">
                              Selected
                            </Badge>
                          )}
                        </div>
                        <p className="text-sm text-muted-foreground">
                          {order.items.length} items
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="font-bold">₹{order.total?.toFixed(0) || 0}</p>
                      </div>
                    </div>
                  </div>
                );
              })}

              {orders.length === 0 && (
                <p className="text-center text-muted-foreground py-8">
                  No orders available to merge
                </p>
              )}
            </div>
          </ScrollArea>

          {/* Merged Bill Summary */}
          {selectedOrderIds.length >= 2 && (
            <div className="p-4 rounded-xl bg-muted/50 space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Orders Selected</span>
                <span>{selectedOrderIds.length}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Total Items</span>
                <span>{mergedTotals.itemCount}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Subtotal</span>
                <span>₹{mergedTotals.subtotal.toFixed(0)}</span>
              </div>
              {mergedTotals.tax > 0 && (
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Tax</span>
                  <span>₹{mergedTotals.tax.toFixed(0)}</span>
                </div>
              )}
              {mergedTotals.serviceCharge > 0 && (
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Service Charge</span>
                  <span>₹{mergedTotals.serviceCharge.toFixed(0)}</span>
                </div>
              )}
              <div className="flex justify-between font-bold text-lg pt-2 border-t">
                <span>Merged Total</span>
                <span>₹{mergedTotals.total.toFixed(0)}</span>
              </div>
            </div>
          )}

          {/* Payment Method */}
          <div className="space-y-2">
            <Label>Payment Method</Label>
            <div className="grid grid-cols-4 gap-2">
              {paymentMethods.map(method => (
                <Button
                  key={method.id}
                  variant={paymentMethod === method.id ? 'default' : 'outline'}
                  className="h-12 flex-col gap-1"
                  onClick={() => setPaymentMethod(method.id)}
                >
                  <method.icon className="w-4 h-4" />
                  <span className="text-xs">{method.label}</span>
                </Button>
              ))}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleProcessMergedBill}
            disabled={selectedOrderIds.length < 2 || isProcessing}
            className="gap-2"
          >
            {isProcessing ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Check className="w-4 h-4" />
            )}
            Merge & Pay ₹{mergedTotals.total.toFixed(0)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
