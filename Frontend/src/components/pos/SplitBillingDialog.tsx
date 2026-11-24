'use client';

import { useState, useEffect } from 'react';
import {
  Users,
  Split,
  CreditCard,
  Banknote,
  Smartphone,
  Wallet,
  Check,
  Loader2,
  ChevronRight,
  Minus,
  Plus,
  ArrowRight
} from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
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

interface SplitPerson {
  id: number;
  name: string;
  items: { itemId: string; quantity: number }[];
  customAmount: number;
  paid: boolean;
  paymentMethod: PaymentMethod;
}

interface SplitBillingDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  order: Order | null;
  onComplete: () => void;
}

const paymentMethods: { id: PaymentMethod; label: string; icon: React.ElementType }[] = [
  { id: 'cash', label: 'Cash', icon: Banknote },
  { id: 'card', label: 'Card', icon: CreditCard },
  { id: 'upi', label: 'UPI', icon: Smartphone },
  { id: 'wallet', label: 'Wallet', icon: Wallet },
];

export function SplitBillingDialog({ open, onOpenChange, order, onComplete }: SplitBillingDialogProps) {
  const [splitType, setSplitType] = useState<'equal' | 'items' | 'custom'>('equal');
  const [splitCount, setSplitCount] = useState(2);
  const [persons, setPersons] = useState<SplitPerson[]>([]);
  const [currentPersonIndex, setCurrentPersonIndex] = useState(0);
  const [isProcessing, setIsProcessing] = useState(false);
  const [step, setStep] = useState<'setup' | 'assign' | 'pay'>('setup');

  // Initialize persons when split count changes
  useEffect(() => {
    if (!order) return;
    
    const newPersons: SplitPerson[] = Array.from({ length: splitCount }, (_, i) => ({
      id: i + 1,
      name: `Person ${i + 1}`,
      items: [],
      customAmount: splitType === 'equal' ? order.total / splitCount : 0,
      paid: false,
      paymentMethod: 'cash'
    }));
    setPersons(newPersons);
  }, [splitCount, order, splitType]);

  // Calculate person's total based on assigned items
  const calculatePersonTotal = (person: SplitPerson): number => {
    if (!order) return 0;
    
    if (splitType === 'equal') {
      return order.total / splitCount;
    }
    
    if (splitType === 'custom') {
      return person.customAmount;
    }
    
    // Item-wise split
    let total = 0;
    person.items.forEach(({ itemId, quantity }) => {
      const item = order.items.find(i => i.id === itemId);
      if (item) {
        total += (item.unit_price * quantity);
      }
    });
    
    // Add proportional tax and service charge
    const proportion = order.subtotal > 0 ? total / order.subtotal : 0;
    total += (order.tax || 0) * proportion;
    total += (order.service_charge || 0) * proportion;
    
    return total;
  };

  // Get remaining quantity for an item across all persons
  const getRemainingQuantity = (itemId: string): number => {
    if (!order) return 0;
    const item = order.items.find(i => i.id === itemId);
    if (!item) return 0;
    
    const assigned = persons.reduce((sum, p) => {
      const personItem = p.items.find(i => i.itemId === itemId);
      return sum + (personItem?.quantity || 0);
    }, 0);
    
    return item.quantity - assigned;
  };

  // Assign item to person
  const assignItemToPerson = (personIndex: number, itemId: string, qty: number) => {
    const remaining = getRemainingQuantity(itemId);
    const actualQty = Math.min(qty, remaining);
    
    if (actualQty <= 0) return;
    
    setPersons(prev => prev.map((p, i) => {
      if (i !== personIndex) return p;
      
      const existingItem = p.items.find(item => item.itemId === itemId);
      if (existingItem) {
        return {
          ...p,
          items: p.items.map(item => 
            item.itemId === itemId 
              ? { ...item, quantity: item.quantity + actualQty }
              : item
          )
        };
      }
      
      return {
        ...p,
        items: [...p.items, { itemId, quantity: actualQty }]
      };
    }));
  };

  // Remove item from person
  const removeItemFromPerson = (personIndex: number, itemId: string) => {
    setPersons(prev => prev.map((p, i) => {
      if (i !== personIndex) return p;
      return {
        ...p,
        items: p.items.filter(item => item.itemId !== itemId)
      };
    }));
  };

  // Process payment for a person
  const processPersonPayment = async (personIndex: number) => {
    if (!order) return;
    
    const person = persons[personIndex];
    const amount = calculatePersonTotal(person);
    
    if (amount <= 0) {
      toast({
        title: "No amount to pay",
        description: "This person has no items or amount assigned",
        variant: "destructive"
      });
      return;
    }

    setIsProcessing(true);
    try {
      // Check if all splits are being paid
      const allPaidAfterThis = persons.every((p, i) => 
        i === personIndex ? true : p.paid
      );

      if (allPaidAfterThis) {
        // Every person's share becomes one payment on a single bill. Fold rounding drift
        // (a few paise) into the last share so the bill closes exactly.
        const shares = persons.map((p) => ({ amount: calculatePersonTotal(p), method: p.paymentMethod, reference: `Split payment - ${p.name}`, label: p.name }));
        const drift = Math.round((order.total - shares.reduce((s, x) => s + x.amount, 0)) * 100) / 100;
        if (Math.abs(drift) > 0 && Math.abs(drift) <= 1) shares[shares.length - 1].amount += drift;

        const bill = await apiClient.snake.post(`/billing/orders/${order.id}/split`, { splits: shares.filter((x) => x.amount > 0) });

        toast({
          title: "All payments complete!",
          description: `Bill ${bill.bill_number} has been generated.`
        });

        onComplete();
        onOpenChange(false);
      } else {
        // Mark this person as paid
        setPersons(prev => prev.map((p, i) => 
          i === personIndex ? { ...p, paid: true } : p
        ));

        toast({
          title: "Payment recorded",
          description: `${person.name} paid ₹${amount.toFixed(0)}`
        });
      }
    } catch (error) {
      console.error('Error processing split payment:', error);
      toast({
        title: "Payment failed",
        description: "An error occurred while processing the payment",
        variant: "destructive"
      });
    } finally {
      setIsProcessing(false);
    }
  };

  // Quick split functions
  const autoDistributeEqual = () => {
    if (!order) return;
    const amount = order.total / splitCount;
    setPersons(prev => prev.map(p => ({ ...p, customAmount: amount })));
  };

  const autoDistributeItems = () => {
    if (!order) return;
    
    // Distribute items round-robin
    const newPersons = persons.map(p => ({ ...p, items: [] as { itemId: string; quantity: number }[] }));
    
    order.items.forEach((item, itemIndex) => {
      for (let q = 0; q < item.quantity; q++) {
        const personIndex = (itemIndex + q) % splitCount;
        const existingItem = newPersons[personIndex].items.find(i => i.itemId === item.id);
        if (existingItem) {
          existingItem.quantity += 1;
        } else {
          newPersons[personIndex].items.push({ itemId: item.id, quantity: 1 });
        }
      }
    });
    
    setPersons(newPersons);
  };

  if (!order) return null;

  const totalPaid = persons.filter(p => p.paid).reduce((sum, p) => sum + calculatePersonTotal(p), 0);
  const totalRemaining = order.total - totalPaid;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Split className="w-5 h-5" />
            Split Bill - {order.order_number}
          </DialogTitle>
        </DialogHeader>

        <div className="py-4">
          {/* Progress Steps */}
          <div className="flex items-center justify-center gap-2 mb-6">
            {['setup', 'assign', 'pay'].map((s, i) => (
              <div key={s} className="flex items-center">
                <div className={cn(
                  "w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium",
                  step === s ? "bg-primary text-primary-foreground" :
                  ['setup', 'assign', 'pay'].indexOf(step) > i ? "bg-primary/20 text-primary" :
                  "bg-muted text-muted-foreground"
                )}>
                  {i + 1}
                </div>
                {i < 2 && <ChevronRight className="w-4 h-4 mx-2 text-muted-foreground" />}
              </div>
            ))}
          </div>

          {/* Bill Summary */}
          <div className="p-4 rounded-xl bg-muted/50 mb-6">
            <div className="flex justify-between items-center">
              <div>
                <p className="text-sm text-muted-foreground">Total Bill</p>
                <p className="text-2xl font-bold">₹{order.total.toFixed(0)}</p>
              </div>
              <div className="text-right">
                <p className="text-sm text-muted-foreground">Remaining</p>
                <p className={cn(
                  "text-xl font-bold",
                  totalRemaining <= 0 ? "text-emerald-600" : "text-foreground"
                )}>
                  ₹{totalRemaining.toFixed(0)}
                </p>
              </div>
            </div>
          </div>

          {/* Step 1: Setup */}
          {step === 'setup' && (
            <div className="space-y-6">
              <div className="space-y-3">
                <Label>Number of People</Label>
                <div className="flex items-center gap-3">
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={() => setSplitCount(Math.max(2, splitCount - 1))}
                    disabled={splitCount <= 2}
                  >
                    <Minus className="w-4 h-4" />
                  </Button>
                  <div className="w-16 text-center">
                    <span className="text-3xl font-bold">{splitCount}</span>
                  </div>
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={() => setSplitCount(Math.min(10, splitCount + 1))}
                    disabled={splitCount >= 10}
                  >
                    <Plus className="w-4 h-4" />
                  </Button>
                </div>
              </div>

              <div className="space-y-3">
                <Label>Split Method</Label>
                <div className="grid grid-cols-3 gap-2">
                  <Button
                    variant={splitType === 'equal' ? 'default' : 'outline'}
                    className="h-20 flex-col gap-1"
                    onClick={() => setSplitType('equal')}
                  >
                    <Users className="w-5 h-5" />
                    <span className="text-sm">Equal Split</span>
                    <span className="text-xs text-muted-foreground">₹{(order.total / splitCount).toFixed(0)} each</span>
                  </Button>
                  <Button
                    variant={splitType === 'items' ? 'default' : 'outline'}
                    className="h-20 flex-col gap-1"
                    onClick={() => setSplitType('items')}
                  >
                    <Split className="w-5 h-5" />
                    <span className="text-sm">By Items</span>
                    <span className="text-xs text-muted-foreground">Assign items</span>
                  </Button>
                  <Button
                    variant={splitType === 'custom' ? 'default' : 'outline'}
                    className="h-20 flex-col gap-1"
                    onClick={() => setSplitType('custom')}
                  >
                    <CreditCard className="w-5 h-5" />
                    <span className="text-sm">Custom</span>
                    <span className="text-xs text-muted-foreground">Set amounts</span>
                  </Button>
                </div>
              </div>

              <Button 
                className="w-full" 
                onClick={() => setStep(splitType === 'equal' ? 'pay' : 'assign')}
              >
                Continue <ArrowRight className="w-4 h-4 ml-2" />
              </Button>
            </div>
          )}

          {/* Step 2: Assign Items (for item-wise or custom split) */}
          {step === 'assign' && (
            <div className="space-y-4">
              {splitType === 'items' && (
                <>
                  <div className="flex justify-between items-center">
                    <Label>Assign Items to People</Label>
                    <Button variant="outline" size="sm" onClick={autoDistributeItems}>
                      Auto-Distribute
                    </Button>
                  </div>

                  <Tabs value={String(currentPersonIndex)} onValueChange={(v) => setCurrentPersonIndex(Number(v))}>
                    <TabsList className="w-full">
                      {persons.map((p, i) => (
                        <TabsTrigger key={i} value={String(i)} className="flex-1">
                          {p.name}
                          <Badge variant="secondary" className="ml-1">
                            ₹{calculatePersonTotal(p).toFixed(0)}
                          </Badge>
                        </TabsTrigger>
                      ))}
                    </TabsList>

                    {persons.map((person, personIndex) => (
                      <TabsContent key={personIndex} value={String(personIndex)} className="mt-4">
                        <ScrollArea className="h-[200px]">
                          <div className="space-y-2">
                            {order.items.map(item => {
                              const assignedQty = person.items.find(i => i.itemId === item.id)?.quantity || 0;
                              const remaining = getRemainingQuantity(item.id);
                              
                              return (
                                <div 
                                  key={item.id}
                                  className="flex items-center justify-between p-3 rounded-lg border"
                                >
                                  <div className="flex items-center gap-3">
                                    <Checkbox
                                      checked={assignedQty > 0}
                                      onCheckedChange={(checked) => {
                                        if (checked) {
                                          assignItemToPerson(personIndex, item.id, 1);
                                        } else {
                                          removeItemFromPerson(personIndex, item.id);
                                        }
                                      }}
                                    />
                                    <div>
                                      <p className="font-medium">{item.menu_item?.name}</p>
                                      <p className="text-sm text-muted-foreground">
                                        ₹{item.unit_price} × {item.quantity}
                                      </p>
                                    </div>
                                  </div>
                                  <div className="flex items-center gap-2">
                                    <Button
                                      variant="outline"
                                      size="icon"
                                      className="h-8 w-8"
                                      onClick={() => {
                                        if (assignedQty > 0) {
                                          setPersons(prev => prev.map((p, i) => {
                                            if (i !== personIndex) return p;
                                            const newItems = p.items.map(pi => 
                                              pi.itemId === item.id 
                                                ? { ...pi, quantity: pi.quantity - 1 }
                                                : pi
                                            ).filter(pi => pi.quantity > 0);
                                            return { ...p, items: newItems };
                                          }));
                                        }
                                      }}
                                      disabled={assignedQty <= 0}
                                    >
                                      <Minus className="w-3 h-3" />
                                    </Button>
                                    <span className="w-8 text-center font-medium">{assignedQty}</span>
                                    <Button
                                      variant="outline"
                                      size="icon"
                                      className="h-8 w-8"
                                      onClick={() => assignItemToPerson(personIndex, item.id, 1)}
                                      disabled={remaining <= 0}
                                    >
                                      <Plus className="w-3 h-3" />
                                    </Button>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </ScrollArea>
                      </TabsContent>
                    ))}
                  </Tabs>
                </>
              )}

              {splitType === 'custom' && (
                <div className="space-y-3">
                  <div className="flex justify-between items-center">
                    <Label>Custom Amounts</Label>
                    <Button variant="outline" size="sm" onClick={autoDistributeEqual}>
                      Split Equally
                    </Button>
                  </div>
                  
                  {persons.map((person, i) => (
                    <div key={i} className="flex items-center gap-3 p-3 rounded-lg border">
                      <Input
                        value={person.name}
                        onChange={(e) => setPersons(prev => prev.map((p, j) => 
                          j === i ? { ...p, name: e.target.value } : p
                        ))}
                        className="w-32"
                      />
                      <div className="flex-1">
                        <Input
                          type="number"
                          value={person.customAmount || ''}
                          onChange={(e) => setPersons(prev => prev.map((p, j) => 
                            j === i ? { ...p, customAmount: Number(e.target.value) } : p
                          ))}
                          placeholder="Amount"
                        />
                      </div>
                      <span className="text-sm text-muted-foreground">
                        ₹{person.customAmount.toFixed(0)}
                      </span>
                    </div>
                  ))}
                  
                  <div className="flex justify-between items-center p-3 bg-muted rounded-lg">
                    <span>Total Assigned</span>
                    <span className={cn(
                      "font-bold",
                      Math.abs(persons.reduce((s, p) => s + p.customAmount, 0) - order.total) < 1
                        ? "text-emerald-600"
                        : "text-destructive"
                    )}>
                      ₹{persons.reduce((s, p) => s + p.customAmount, 0).toFixed(0)} / ₹{order.total.toFixed(0)}
                    </span>
                  </div>
                </div>
              )}

              <div className="flex gap-2">
                <Button variant="outline" onClick={() => setStep('setup')}>
                  Back
                </Button>
                <Button className="flex-1" onClick={() => setStep('pay')}>
                  Continue to Payment <ArrowRight className="w-4 h-4 ml-2" />
                </Button>
              </div>
            </div>
          )}

          {/* Step 3: Collect Payments */}
          {step === 'pay' && (
            <div className="space-y-4">
              <ScrollArea className="h-[300px]">
                <div className="space-y-3">
                  {persons.map((person, i) => {
                    const amount = calculatePersonTotal(person);
                    
                    return (
                      <div 
                        key={i}
                        className={cn(
                          "p-4 rounded-xl border",
                          person.paid ? "bg-emerald-500/10 border-emerald-500/30" : "border-border"
                        )}
                      >
                        <div className="flex items-center justify-between mb-3">
                          <div className="flex items-center gap-2">
                            <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                              <span className="text-sm font-bold text-primary">{i + 1}</span>
                            </div>
                            <span className="font-medium">{person.name}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className={cn(
                              "text-xl font-bold",
                              person.paid && "text-emerald-600"
                            )}>
                              ₹{amount.toFixed(0)}
                            </span>
                            {person.paid && <Check className="w-5 h-5 text-emerald-600" />}
                          </div>
                        </div>

                        {!person.paid && (
                          <div className="space-y-3">
                            <div className="flex gap-1">
                              {paymentMethods.map(method => (
                                <Button
                                  key={method.id}
                                  variant={person.paymentMethod === method.id ? 'default' : 'outline'}
                                  size="sm"
                                  className="flex-1"
                                  onClick={() => setPersons(prev => prev.map((p, j) => 
                                    j === i ? { ...p, paymentMethod: method.id } : p
                                  ))}
                                >
                                  <method.icon className="w-4 h-4 mr-1" />
                                  {method.label}
                                </Button>
                              ))}
                            </div>
                            <Button
                              className="w-full"
                              onClick={() => processPersonPayment(i)}
                              disabled={isProcessing}
                            >
                              {isProcessing ? (
                                <Loader2 className="w-4 h-4 animate-spin mr-2" />
                              ) : (
                                <Check className="w-4 h-4 mr-2" />
                              )}
                              Mark as Paid
                            </Button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </ScrollArea>

              <Button variant="outline" onClick={() => setStep(splitType === 'equal' ? 'setup' : 'assign')}>
                Back
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
