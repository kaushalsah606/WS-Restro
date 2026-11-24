'use client';

import { useState, useMemo } from 'react';
import {
  Receipt,
  Check,
  Loader2,
  Minus,
  Plus,
  CreditCard,
  Banknote,
  Smartphone,
  Wallet
} from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
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
  subtotal: number;
  tax: number;
  service_charge: number;
  discount: number;
  total: number;
  items: OrderItem[];
}

interface PartialBillingDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  order: Order | null;
  onComplete: () => void;
}

interface SelectedItem {
  itemId: string;
  quantity: number;
}

const paymentMethods: { id: PaymentMethod; label: string; icon: React.ElementType }[] = [
  { id: 'cash', label: 'Cash', icon: Banknote },
  { id: 'card', label: 'Card', icon: CreditCard },
  { id: 'upi', label: 'UPI', icon: Smartphone },
  { id: 'wallet', label: 'Wallet', icon: Wallet },
];

export function PartialBillingDialog({ open, onOpenChange, order, onComplete }: PartialBillingDialogProps) {
  const [selectedItems, setSelectedItems] = useState<SelectedItem[]>([]);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('cash');
  const [isProcessing, setIsProcessing] = useState(false);

  // Calculate partial bill total
  const partialTotal = useMemo(() => {
    if (!order) return { subtotal: 0, tax: 0, serviceCharge: 0, total: 0 };

    let subtotal = 0;
    selectedItems.forEach(({ itemId, quantity }) => {
      const item = order.items.find(i => i.id === itemId);
      if (item) {
        subtotal += item.unit_price * quantity;
      }
    });

    // Calculate proportional tax and service charge
    const proportion = order.subtotal > 0 ? subtotal / order.subtotal : 0;
    const tax = (order.tax || 0) * proportion;
    const serviceCharge = (order.service_charge || 0) * proportion;
    const total = subtotal + tax + serviceCharge;

    return { subtotal, tax, serviceCharge, total };
  }, [order, selectedItems]);

  const toggleItem = (itemId: string, maxQty: number) => {
    const existing = selectedItems.find(s => s.itemId === itemId);
    if (existing) {
      setSelectedItems(selectedItems.filter(s => s.itemId !== itemId));
    } else {
      setSelectedItems([...selectedItems, { itemId, quantity: maxQty }]);
    }
  };

  const updateItemQuantity = (itemId: string, delta: number) => {
    const item = order?.items.find(i => i.id === itemId);
    if (!item) return;

    setSelectedItems(prev => prev.map(s => {
      if (s.itemId !== itemId) return s;
      const newQty = Math.max(1, Math.min(item.quantity, s.quantity + delta));
      return { ...s, quantity: newQty };
    }));
  };

  const handleProcessPartialBill = async () => {
    if (!order || selectedItems.length === 0) return;

    setIsProcessing(true);
    try {
      // server prices the selected lines, records the payment and shrinks the open order
      const bill = await apiClient.snake.post('/billing/partial', {
        order_id: order.id,
        items: selectedItems.map((s) => ({ item_id: s.itemId, quantity: s.quantity })),
        method: paymentMethod,
      });

      toast({
        title: "Partial bill processed!",
        description: `Bill ${bill.bill_number} - ₹${Number(bill.total).toFixed(0)}`,
      });

      setSelectedItems([]);
      onComplete();
      onOpenChange(false);
    } catch (error) {
      console.error('Error processing partial bill:', error);
      toast({
        title: "Error",
        description: errorMessage(error, "Failed to process partial bill"),
        variant: "destructive",
      });
    } finally {
      setIsProcessing(false);
    }
  };

  if (!order) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Receipt className="w-5 h-5" />
            Partial Bill - {order.order_number}
          </DialogTitle>
        </DialogHeader>

        <div className="py-4 space-y-4">
          {/* Instructions */}
          <p className="text-sm text-muted-foreground">
            Select items to bill separately. The remaining items will stay on the order.
          </p>

          {/* Item Selection */}
          <ScrollArea className="h-[250px] border rounded-lg p-3">
            <div className="space-y-2">
              {order.items.map(item => {
                const selected = selectedItems.find(s => s.itemId === item.id);
                const isSelected = !!selected;

                return (
                  <div
                    key={item.id}
                    className={cn(
                      "flex items-center justify-between p-3 rounded-lg border transition-colors",
                      isSelected ? "bg-primary/5 border-primary/30" : "hover:bg-muted/50"
                    )}
                  >
                    <div className="flex items-center gap-3">
                      <Checkbox
                        checked={isSelected}
                        onCheckedChange={() => toggleItem(item.id, item.quantity)}
                      />
                      <div>
                        <p className="font-medium">{item.menu_item?.name}</p>
                        <p className="text-sm text-muted-foreground">
                          ₹{item.unit_price} × {item.quantity} = ₹{item.total}
                        </p>
                      </div>
                    </div>

                    {isSelected && (
                      <div className="flex items-center gap-2">
                        <Button
                          variant="outline"
                          size="icon"
                          className="h-7 w-7"
                          onClick={() => updateItemQuantity(item.id, -1)}
                          disabled={selected.quantity <= 1}
                        >
                          <Minus className="w-3 h-3" />
                        </Button>
                        <span className="w-8 text-center font-medium">
                          {selected.quantity}
                        </span>
                        <Button
                          variant="outline"
                          size="icon"
                          className="h-7 w-7"
                          onClick={() => updateItemQuantity(item.id, 1)}
                          disabled={selected.quantity >= item.quantity}
                        >
                          <Plus className="w-3 h-3" />
                        </Button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </ScrollArea>

          {/* Partial Bill Summary */}
          {selectedItems.length > 0 && (
            <div className="p-4 rounded-xl bg-muted/50 space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Subtotal</span>
                <span>₹{partialTotal.subtotal.toFixed(0)}</span>
              </div>
              {partialTotal.tax > 0 && (
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Tax</span>
                  <span>₹{partialTotal.tax.toFixed(0)}</span>
                </div>
              )}
              {partialTotal.serviceCharge > 0 && (
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Service Charge</span>
                  <span>₹{partialTotal.serviceCharge.toFixed(0)}</span>
                </div>
              )}
              <div className="flex justify-between font-bold text-lg pt-2 border-t">
                <span>Partial Total</span>
                <span>₹{partialTotal.total.toFixed(0)}</span>
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
            onClick={handleProcessPartialBill}
            disabled={selectedItems.length === 0 || isProcessing}
            className="gap-2"
          >
            {isProcessing ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Check className="w-4 h-4" />
            )}
            Process ₹{partialTotal.total.toFixed(0)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
