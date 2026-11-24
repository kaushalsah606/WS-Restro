'use client';

import { useState, useEffect } from 'react';
import { 
  CreditCard, 
  Banknote, 
  Smartphone, 
  Wallet, 
  Percent, 
  Receipt,
  Printer,
  Check,
  X,
  Plus,
  Trash2,
  Split,
  Loader2,
  Users
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { apiClient, errorMessage } from '@/lib/api-client';
import { useBranchRealtime } from '@/hooks/useBranchRealtime';
import { cn } from '@/lib/utils';
import { toast } from '@/hooks/use-toast';
import type { PaymentMethod } from '@/types/pos';
import { SplitBillingDialog } from './SplitBillingDialog';

interface Order {
  id: string;
  order_number: string;
  status: string;
  subtotal: number;
  tax: number;
  service_charge: number;
  discount: number;
  total: number;
  table_id: string | null;
  items: OrderItem[];
}

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

interface TableData {
  id: string;
  table_number: string;
}

interface Payment {
  method: PaymentMethod;
  amount: number;
}

const paymentMethods: { id: PaymentMethod; label: string; icon: React.ElementType }[] = [
  { id: 'cash', label: 'Cash', icon: Banknote },
  { id: 'card', label: 'Card', icon: CreditCard },
  { id: 'upi', label: 'UPI', icon: Smartphone },
  { id: 'wallet', label: 'Wallet', icon: Wallet },
];

export function BillingView() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [tables, setTables] = useState<TableData[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [isPaymentOpen, setIsPaymentOpen] = useState(false);
  const [isSplitOpen, setIsSplitOpen] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  
  // Payment state
  const [payments, setPayments] = useState<Payment[]>([{ method: 'cash', amount: 0 }]);
  const [discount, setDiscount] = useState(0);
  const [discountType, setDiscountType] = useState<'amount' | 'percent'>('amount');
  const [amountReceived, setAmountReceived] = useState('');
  
  // Split bill state
  const [splitCount, setSplitCount] = useState(2);
  const [splitType, setSplitType] = useState<'equal' | 'custom'>('equal');
  const [splitAmounts, setSplitAmounts] = useState<number[]>([]);

  useEffect(() => {
    fetchData();
  }, []);

  // live updates over Socket.IO (orders / bills changed anywhere in the branch)
  useBranchRealtime({
    showNotifications: false,
    enableSounds: false,
    onOrderUpdate: () => fetchData(),
    onBillUpdate: () => fetchData(),
    onTableUpdate: () => fetchData(),
  });

  const fetchData = async () => {
    try {
      const [tablesData, ordersData] = await Promise.all([
        apiClient.snake.get<TableData[]>('/tables'),
        apiClient.snake.get<any[]>('/orders', { status: 'preparing,ready,served', unpaid: true, limit: 200 }),
      ]);
      setTables(tablesData || []);
      setOrders(
        (ordersData || []).map((o) => ({
          ...o,
          items: (o.items || [])
            .filter((i: any) => i.status !== 'cancelled' && !i.billed_by_bill_id)
            .map((i: any) => ({ ...i, menu_item: { id: i.menu_item_id, name: i.name } })),
        }))
      );
    } catch (error) {
      console.error('Error fetching billing data:', error);
      toast({
        title: 'Error',
        description: errorMessage(error, 'Failed to load billing data'),
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const getTableNumber = (tableId: string | null) => {
    if (!tableId) return 'Takeaway';
    const table = tables.find(t => t.id === tableId);
    return table ? table.table_number : '?';
  };

  const calculateDiscountedTotal = (order: Order) => {
    if (discountType === 'percent') {
      return order.total - (order.total * discount / 100);
    }
    return order.total - discount;
  };

  const getTotalPayments = () => {
    return payments.reduce((sum, p) => sum + p.amount, 0);
  };

  const handleAddPayment = () => {
    setPayments([...payments, { method: 'cash', amount: 0 }]);
  };

  const handleRemovePayment = (index: number) => {
    if (payments.length > 1) {
      setPayments(payments.filter((_, i) => i !== index));
    }
  };

  const handlePaymentChange = (index: number, field: 'method' | 'amount', value: PaymentMethod | number) => {
    const updated = [...payments];
    if (field === 'method') {
      updated[index].method = value as PaymentMethod;
    } else {
      updated[index].amount = value as number;
    }
    setPayments(updated);
  };

  const handleProcessPayment = async () => {
    if (!selectedOrder) return;
    
    const finalTotal = calculateDiscountedTotal(selectedOrder);
    const totalPaid = getTotalPayments();
    
    if (totalPaid < finalTotal) {
      toast({
        title: "Insufficient payment",
        description: `Total payments (₹${totalPaid.toFixed(0)}) must equal or exceed the bill (₹${finalTotal.toFixed(0)})`,
        variant: "destructive",
      });
      return;
    }

    setIsProcessing(true);
    try {
      // one atomic server-side call: bill + discount + payments + order/table settlement
      const bill = await apiClient.snake.post(`/billing/orders/${selectedOrder.id}/checkout`, {
        discount: discount > 0 ? discount : undefined,
        discount_type: discountType,
        payments: payments.filter((p) => p.amount > 0).map((p) => ({ method: p.method, amount: p.amount })),
      });
      const billNumber = bill.bill_number;

      toast({
        title: "Payment successful!",
        description: `Bill ${billNumber} has been generated.`,
      });

      // Reset state
      setIsPaymentOpen(false);
      setSelectedOrder(null);
      setPayments([{ method: 'cash', amount: 0 }]);
      setDiscount(0);
      setAmountReceived('');
      fetchData();
    } catch (error) {
      console.error('Error processing payment:', error);
      toast({
        title: "Payment failed",
        description: errorMessage(error, 'An error occurred while processing the payment'),
        variant: "destructive",
      });
    } finally {
      setIsProcessing(false);
    }
  };

  const handleSplitBill = () => {
    if (!selectedOrder) return;
    
    const finalTotal = calculateDiscountedTotal(selectedOrder);
    
    if (splitType === 'equal') {
      const splitAmount = finalTotal / splitCount;
      setSplitAmounts(Array(splitCount).fill(splitAmount));
    } else {
      setSplitAmounts(Array(splitCount).fill(0));
    }
    
    setIsSplitOpen(true);
  };

  const handlePaySplit = async (index: number) => {
    if (!selectedOrder) return;
    
    const amount = splitAmounts[index];
    
    // Create a partial payment record
    toast({
      title: "Split payment recorded",
      description: `Payment ${index + 1} of ₹${amount.toFixed(0)} recorded.`,
    });
    
    // Mark this split as paid
    const newAmounts = [...splitAmounts];
    newAmounts[index] = -Math.abs(newAmounts[index]); // Use negative to indicate paid
    setSplitAmounts(newAmounts);
  };

  const openPaymentDialog = (order: Order) => {
    setSelectedOrder(order);
    setPayments([{ method: 'cash', amount: order.total }]);
    setDiscount(0);
    setIsPaymentOpen(true);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-foreground">Billing</h2>
          <p className="text-muted-foreground">Generate bills and process payments</p>
        </div>
        <Badge variant="outline" className="text-sm">
          {orders.length} Pending Bills
        </Badge>
      </div>

      {/* Billable Orders Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {orders.length === 0 ? (
          <div className="col-span-full flex flex-col items-center justify-center py-20 text-muted-foreground">
            <Receipt className="w-16 h-16 mb-4 opacity-50" />
            <h3 className="text-xl font-semibold mb-2">No Bills Pending</h3>
            <p>Orders ready for billing will appear here</p>
          </div>
        ) : (
          orders.map(order => (
            <Card key={order.id} className="border-none shadow-md">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-12 h-12 rounded-xl bg-primary flex items-center justify-center text-primary-foreground font-bold">
                      T{getTableNumber(order.table_id)}
                    </div>
                    <div>
                      <CardTitle className="text-base">{order.order_number}</CardTitle>
                      <p className="text-sm text-muted-foreground">
                        {order.items.length} items
                      </p>
                    </div>
                  </div>
                  <Badge 
                    variant="outline"
                    className={cn(
                      "capitalize",
                      order.status === 'ready' && "bg-emerald-500/10 text-emerald-600 border-emerald-500/30",
                      order.status === 'served' && "bg-blue-500/10 text-blue-600 border-blue-500/30",
                      order.status === 'preparing' && "bg-amber-500/10 text-amber-600 border-amber-500/30",
                    )}
                  >
                    {order.status}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent>
                {/* Items Summary */}
                <div className="space-y-2 mb-4 max-h-32 overflow-y-auto">
                  {order.items.map(item => (
                    <div key={item.id} className="flex justify-between text-sm">
                      <span className="text-muted-foreground">
                        {item.quantity}× {item.menu_item?.name || 'Item'}
                      </span>
                      <span className="font-medium">₹{item.total}</span>
                    </div>
                  ))}
                </div>

                {/* Totals */}
                <div className="space-y-2 pt-4 border-t border-border">
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Subtotal</span>
                    <span>₹{order.subtotal?.toFixed(0) || 0}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Tax</span>
                    <span>₹{order.tax?.toFixed(0) || 0}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Service Charge</span>
                    <span>₹{order.service_charge?.toFixed(0) || 0}</span>
                  </div>
                  <div className="flex justify-between font-bold text-lg pt-2 border-t border-border">
                    <span>Total</span>
                    <span>₹{order.total?.toFixed(0) || 0}</span>
                  </div>
                </div>

                {/* Actions */}
                <div className="flex gap-2 mt-4">
                  <Button 
                    className="flex-1 gap-2"
                    onClick={() => openPaymentDialog(order)}
                  >
                    <CreditCard className="w-4 h-4" />
                    Pay Now
                  </Button>
                  <Button 
                    variant="outline" 
                    size="icon"
                    onClick={() => {
                      setSelectedOrder(order);
                      setIsSplitOpen(true);
                    }}
                    title="Split Bill"
                  >
                    <Split className="w-4 h-4" />
                  </Button>
                  <Button variant="outline" size="icon" title="Print Bill">
                    <Printer className="w-4 h-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>

      {/* Payment Dialog */}
      <Dialog open={isPaymentOpen} onOpenChange={setIsPaymentOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Process Payment</DialogTitle>
          </DialogHeader>
          {selectedOrder && (
            <div className="space-y-6 py-4">
              {/* Order Summary */}
              <div className="p-4 rounded-xl bg-muted/50">
                <div className="flex justify-between items-center mb-2">
                  <span className="text-muted-foreground">Order</span>
                  <span className="font-medium">{selectedOrder.order_number}</span>
                </div>
                <div className="flex justify-between items-center text-2xl font-bold">
                  <span>Total</span>
                  <span>₹{calculateDiscountedTotal(selectedOrder).toFixed(0)}</span>
                </div>
              </div>

              <Tabs defaultValue="single" className="w-full">
                <TabsList className="grid w-full grid-cols-2">
                  <TabsTrigger value="single">Single Payment</TabsTrigger>
                  <TabsTrigger value="mixed">Mixed Payment</TabsTrigger>
                </TabsList>

                <TabsContent value="single" className="space-y-4 mt-4">
                  {/* Payment Method Selection */}
                  <div className="space-y-3">
                    <Label>Payment Method</Label>
                    <div className="grid grid-cols-2 gap-2">
                      {paymentMethods.map(method => (
                        <Button
                          key={method.id}
                          variant={payments[0]?.method === method.id ? 'default' : 'outline'}
                          className={cn(
                            "h-16 flex-col gap-1",
                            payments[0]?.method === method.id && "bg-primary text-primary-foreground"
                          )}
                          onClick={() => handlePaymentChange(0, 'method', method.id)}
                        >
                          <method.icon className="w-5 h-5" />
                          <span className="text-sm">{method.label}</span>
                        </Button>
                      ))}
                    </div>
                  </div>

                  {/* Cash Amount Received */}
                  {payments[0]?.method === 'cash' && (
                    <div className="space-y-2">
                      <Label>Amount Received</Label>
                      <Input
                        type="number"
                        placeholder="Enter amount"
                        value={amountReceived}
                        onChange={(e) => setAmountReceived(e.target.value)}
                        className="text-lg"
                      />
                      {amountReceived && Number(amountReceived) >= calculateDiscountedTotal(selectedOrder) && (
                        <div className="flex justify-between items-center p-3 rounded-lg bg-emerald-500/10 text-emerald-600">
                          <span>Change</span>
                          <span className="font-bold">
                            ₹{(Number(amountReceived) - calculateDiscountedTotal(selectedOrder)).toFixed(0)}
                          </span>
                        </div>
                      )}
                    </div>
                  )}
                </TabsContent>

                <TabsContent value="mixed" className="space-y-4 mt-4">
                  {/* Multiple Payment Methods */}
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <Label>Payment Methods</Label>
                      <Button variant="ghost" size="sm" onClick={handleAddPayment}>
                        <Plus className="w-4 h-4 mr-1" />
                        Add
                      </Button>
                    </div>
                    
                    {payments.map((payment, index) => (
                      <div key={index} className="flex gap-2 items-center">
                        <select
                          className="flex h-10 w-32 rounded-md border border-input bg-background px-3 py-2 text-sm"
                          value={payment.method}
                          onChange={(e) => handlePaymentChange(index, 'method', e.target.value as PaymentMethod)}
                        >
                          {paymentMethods.map(m => (
                            <option key={m.id} value={m.id}>{m.label}</option>
                          ))}
                        </select>
                        <Input
                          type="number"
                          placeholder="Amount"
                          value={payment.amount || ''}
                          onChange={(e) => handlePaymentChange(index, 'amount', Number(e.target.value))}
                          className="flex-1"
                        />
                        {payments.length > 1 && (
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleRemovePayment(index)}
                          >
                            <Trash2 className="w-4 h-4 text-destructive" />
                          </Button>
                        )}
                      </div>
                    ))}
                    
                    <div className="flex justify-between items-center p-2 bg-muted rounded-lg">
                      <span className="text-sm text-muted-foreground">Total Payments</span>
                      <span className={cn(
                        "font-medium",
                        getTotalPayments() >= calculateDiscountedTotal(selectedOrder) 
                          ? "text-emerald-600" 
                          : "text-destructive"
                      )}>
                        ₹{getTotalPayments().toFixed(0)} / ₹{calculateDiscountedTotal(selectedOrder).toFixed(0)}
                      </span>
                    </div>
                  </div>
                </TabsContent>
              </Tabs>

              {/* Discount */}
              <div className="space-y-2">
                <Label className="flex items-center gap-2">
                  <Percent className="w-4 h-4" />
                  Apply Discount
                </Label>
                <div className="flex gap-2">
                  <Input
                    type="number"
                    placeholder="Discount"
                    value={discount || ''}
                    onChange={(e) => setDiscount(Number(e.target.value))}
                    className="flex-1"
                  />
                  <select
                    className="flex h-10 w-24 rounded-md border border-input bg-background px-3 py-2 text-sm"
                    value={discountType}
                    onChange={(e) => setDiscountType(e.target.value as 'amount' | 'percent')}
                  >
                    <option value="amount">₹</option>
                    <option value="percent">%</option>
                  </select>
                </div>
              </div>

              {/* Complete Payment Button */}
              <Button 
                className="w-full h-14 text-lg gap-2"
                onClick={handleProcessPayment}
                disabled={isProcessing}
              >
                {isProcessing ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin" />
                    Processing...
                  </>
                ) : (
                  <>
                    <Check className="w-5 h-5" />
                    Complete Payment
                  </>
                )}
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Split Bill Dialog */}
      <SplitBillingDialog
        open={isSplitOpen}
        onOpenChange={setIsSplitOpen}
        order={selectedOrder}
        onComplete={fetchData}
      />
    </div>
  );
}