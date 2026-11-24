'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { useSearchParams } from 'next/navigation';
import { 
  ShoppingCart, Plus, Minus, Trash2, ChefHat, Clock, CheckCircle2, 
  Loader2, Utensils, Leaf, Flame, MessageSquare, ArrowLeft, RefreshCw,
  UtensilsCrossed, Timer, Bell, CircleDot
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { Textarea } from '@/components/ui/textarea';
import { apiClient, errorMessage } from '@/lib/api-client';
import { socketClient } from '@/lib/socket-client';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';

interface MenuItem {
  id: string;
  name: string;
  description: string | null;
  price: number;
  image: string | null;
  is_veg: boolean;
  is_available: boolean;
  category_id: string;
  preparation_time: number | null;
}

interface Category {
  id: string;
  name: string;
  sort_order: number;
  image: string | null;
}

interface CartItem {
  menuItem: MenuItem;
  quantity: number;
  notes: string;
}

interface OrderItem {
  id: string;
  menu_item_id: string;
  quantity: number;
  status: string;
  notes: string | null;
  menu_items: { name: string; price: number } | null;
}

interface OrderStatus {
  id: string;
  order_number: string;
  status: string;
  created_at: string;
  subtotal: number;
  tax: number;
  total: number;
  items: OrderItem[];
}

interface RestaurantInfo {
  name: string;
  logo: string | null;
}

const ORDER_STEPS = [
  { status: 'pending', label: 'Order Received', icon: Bell },
  { status: 'preparing', label: 'Preparing', icon: ChefHat },
  { status: 'ready', label: 'Ready', icon: UtensilsCrossed },
  { status: 'served', label: 'Served', icon: CheckCircle2 },
];

export default function CustomerOrder() {
  const searchParams = useSearchParams();
  const tableId = searchParams.get('table');
  const branchId = searchParams.get('branch');
  
  const [categories, setCategories] = useState<Category[]>([]);
  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [tableInfo, setTableInfo] = useState<{ table_number: string } | null>(null);
  const [restaurantInfo, setRestaurantInfo] = useState<RestaurantInfo | null>(null);
  const [currentOrder, setCurrentOrder] = useState<OrderStatus | null>(null);
  const [activeItemNotes, setActiveItemNotes] = useState<string | null>(null);
  const [sessionId] = useState(() => {
    if (typeof window === 'undefined') return '';
    const stored = sessionStorage.getItem('customer_session_id');
    if (stored) return stored;
    const newId = `customer-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    sessionStorage.setItem('customer_session_id', newId);
    return newId;
  });
  const [isCartOpen, setIsCartOpen] = useState(false);
  
  const { toast } = useToast();

  // Fetch initial data
  useEffect(() => {
    const fetchData = async () => {
      if (!branchId) {
        setLoading(false);
        return;
      }

      try {
        // Public endpoints: no login needed for the QR menu
        const [info, menu] = await Promise.all([
          apiClient.snake.get<any>(`/public/branches/${branchId}`),
          apiClient.snake.get<any[]>('/public/menu', { branch_id: branchId }),
        ]);
        setRestaurantInfo({ name: info.restaurant_name, logo: info.logo });

        if (tableId) {
          const table = await apiClient.snake.get<any>(`/public/tables/${tableId}`);
          setTableInfo(table);
          // the table already has a running order (e.g. guest reloaded the page)
          if (table?.current_order_id) await fetchExistingOrder(table.current_order_id);
        }

        const cats = menu || [];
        setCategories(cats);
        if (cats.length > 0) setSelectedCategory(cats[0].id);
        setMenuItems(cats.flatMap((c: any) => c.menu_items || []));
      } catch (error) {
        console.error('Error fetching data:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [branchId, tableId]);

  // API order -> the shape this screen renders
  const toOrderStatus = (o: any): OrderStatus => ({
    id: o.id,
    order_number: o.order_number,
    status: o.status,
    created_at: o.created_at,
    subtotal: o.subtotal,
    tax: o.tax,
    total: o.total,
    items: (o.items || [])
      .filter((i: any) => i.status !== 'cancelled')
      .map((i: any) => ({
        id: i.id,
        menu_item_id: i.menu_item_id,
        quantity: i.quantity,
        status: i.status,
        notes: i.notes,
        menu_items: { name: i.name, price: i.unit_price },
      })),
  });

  const fetchExistingOrder = async (orderId: string) => {
    try {
      const data = await apiClient.snake.get<any>(`/public/orders/${orderId}`);
      if (data && data.status !== 'served' && data.status !== 'cancelled') {
        setCurrentOrder(toOrderStatus(data));
      }
    } catch (error) {
      console.error('Error loading order:', error);
    }
  };

  // Live status (pending -> preparing -> ready -> served) pushed over Socket.IO
  useEffect(() => {
    if (!currentOrder?.id) return;
    const id = currentOrder.id;
    socketClient.connect();
    socketClient.joinOrder(id);
    const socket = socketClient.socket;
    const refresh = () => fetchExistingOrder(id);
    socket?.on('order:updated', refresh);
    socket?.on('order:status:changed', refresh);
    return () => {
      socket?.off('order:updated', refresh);
      socket?.off('order:status:changed', refresh);
      socketClient.leaveOrder(id);
    };
  }, [currentOrder?.id]);

  const filteredItems = useMemo(() => {
    if (!selectedCategory) return menuItems;
    return menuItems.filter(item => item.category_id === selectedCategory);
  }, [menuItems, selectedCategory]);

  const cartTotal = useMemo(() => {
    return cart.reduce((sum, item) => sum + item.menuItem.price * item.quantity, 0);
  }, [cart]);

  const cartItemCount = useMemo(() => {
    return cart.reduce((sum, item) => sum + item.quantity, 0);
  }, [cart]);

  const addToCart = useCallback((menuItem: MenuItem) => {
    setCart(prev => {
      const existing = prev.find(item => item.menuItem.id === menuItem.id);
      if (existing) {
        return prev.map(item =>
          item.menuItem.id === menuItem.id
            ? { ...item, quantity: item.quantity + 1 }
            : item
        );
      }
      return [...prev, { menuItem, quantity: 1, notes: '' }];
    });
    
    toast({
      title: "Added to cart",
      description: menuItem.name,
      duration: 1500,
    });
  }, [toast]);

  const updateQuantity = useCallback((menuItemId: string, delta: number) => {
    setCart(prev => {
      return prev
        .map(item => {
          if (item.menuItem.id === menuItemId) {
            const newQty = item.quantity + delta;
            return newQty > 0 ? { ...item, quantity: newQty } : null;
          }
          return item;
        })
        .filter(Boolean) as CartItem[];
    });
  }, []);

  const updateNotes = useCallback((menuItemId: string, notes: string) => {
    setCart(prev => 
      prev.map(item => 
        item.menuItem.id === menuItemId ? { ...item, notes } : item
      )
    );
  }, []);

  const removeFromCart = useCallback((menuItemId: string) => {
    setCart(prev => prev.filter(item => item.menuItem.id !== menuItemId));
  }, []);

  const submitOrder = async () => {
    if (!branchId || cart.length === 0) return;

    setSubmitting(true);
    try {
      // The server prices the items, applies tax/service charge, creates the KOT and occupies the table.
      // (If the table already has a running order the items are appended to it.)
      const order = await apiClient.snake.post<any>('/public/orders', {
        branch_id: branchId,
        table_id: tableId,
        session_id: sessionId,
        items: cart.map((item) => ({ menu_item_id: item.menuItem.id, quantity: item.quantity, notes: item.notes || undefined })),
      });
      const orderNumber = order.order_number;

      setCart([]);
      setIsCartOpen(false);
      setCurrentOrder(toOrderStatus(order));

      toast({
        title: "Order placed successfully!",
        description: `Your order #${orderNumber} has been sent to the kitchen.`,
      });
    } catch (error) {
      console.error('Error submitting order:', error);
      toast({
        title: "Error",
        description: errorMessage(error, "Failed to place order. Please try again."),
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  };

  const addToExistingOrder = async () => {
    if (!currentOrder || cart.length === 0) return;

    setSubmitting(true);
    try {
      await apiClient.snake.post(`/public/orders/${currentOrder.id}/items`, {
        branch_id: branchId,
        items: cart.map((item) => ({ menu_item_id: item.menuItem.id, quantity: item.quantity, notes: item.notes || undefined })),
      });

      setCart([]);
      setIsCartOpen(false);
      await fetchExistingOrder(currentOrder.id);

      toast({
        title: "Items added!",
        description: "New items have been added to your order.",
      });
    } catch (error) {
      console.error('Error adding to order:', error);
      toast({
        title: "Error",
        description: errorMessage(error, "Failed to add items. Please try again."),
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  };

  const getCurrentStep = () => {
    if (!currentOrder) return 0;
    return ORDER_STEPS.findIndex(step => step.status === currentOrder.status);
  };

  // Invalid QR view
  if (!branchId) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-primary/10 via-background to-accent/10 p-4">
        <Card className="w-full max-w-md text-center border-none shadow-lg">
          <CardContent className="pt-12 pb-8 space-y-6">
            <div className="w-24 h-24 mx-auto rounded-full bg-primary/10 flex items-center justify-center">
              <Utensils className="w-12 h-12 text-primary" />
            </div>
            <div className="space-y-2">
              <h1 className="text-2xl font-bold">Invalid QR Code</h1>
              <p className="text-muted-foreground">
                Please scan a valid table QR code to start ordering.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Loading view
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center space-y-4">
          <Loader2 className="w-12 h-12 animate-spin text-primary mx-auto" />
          <p className="text-muted-foreground">Loading menu...</p>
        </div>
      </div>
    );
  }

  // Order tracking view
  if (currentOrder && cart.length === 0) {
    const currentStep = getCurrentStep();
    
    return (
      <div className="min-h-screen bg-gradient-to-br from-primary/5 via-background to-accent/5">
        {/* Header */}
        <div className="sticky top-0 z-10 bg-background/95 backdrop-blur-sm border-b">
          <div className="p-4 flex items-center justify-between">
            <div>
              <h1 className="font-bold text-lg">{restaurantInfo?.name || 'Restaurant'}</h1>
              <p className="text-sm text-muted-foreground">Table {tableInfo?.table_number}</p>
            </div>
            <Button variant="outline" size="sm" onClick={() => fetchExistingOrder(currentOrder.id)}>
              <RefreshCw className="w-4 h-4 mr-2" />
              Refresh
            </Button>
          </div>
        </div>

        <div className="p-4 max-w-lg mx-auto space-y-6">
          {/* Order Status Card */}
          <Card className="overflow-hidden">
            <div className="bg-gradient-to-r from-primary to-primary/80 p-6 text-primary-foreground">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-primary-foreground/80 text-sm">Order Number</p>
                  <p className="text-2xl font-bold">#{currentOrder.order_number}</p>
                </div>
                <div className="w-16 h-16 rounded-full bg-primary-foreground/20 flex items-center justify-center">
                  {(() => {
                    const StepIcon = ORDER_STEPS[currentStep]?.icon;
                    return StepIcon ? <StepIcon className="w-8 h-8" /> : null;
                  })()}
                </div>
              </div>
            </div>
            
            <CardContent className="p-6">
              {/* Progress Steps */}
              <div className="relative">
                <div className="absolute left-4 top-4 bottom-4 w-0.5 bg-muted" />
                <div 
                  className="absolute left-4 top-4 w-0.5 bg-primary transition-all duration-500"
                  style={{ height: `${(currentStep / (ORDER_STEPS.length - 1)) * 100}%` }}
                />
                
                <div className="space-y-6">
                  {ORDER_STEPS.map((step, index) => {
                    const isCompleted = index <= currentStep;
                    const isCurrent = index === currentStep;
                    const StepIcon = step.icon;
                    
                    return (
                      <div key={step.status} className="flex items-center gap-4 relative">
                        <div className={cn(
                          "w-8 h-8 rounded-full flex items-center justify-center z-10 transition-all duration-300",
                          isCompleted 
                            ? "bg-primary text-primary-foreground" 
                            : "bg-muted text-muted-foreground",
                          isCurrent && "ring-4 ring-primary/20"
                        )}>
                          <StepIcon className="w-4 h-4" />
                        </div>
                        <div className="flex-1">
                          <p className={cn(
                            "font-medium transition-colors",
                            isCompleted ? "text-foreground" : "text-muted-foreground"
                          )}>
                            {step.label}
                          </p>
                          {isCurrent && (
                            <p className="text-sm text-primary animate-pulse">In progress...</p>
                          )}
                        </div>
                        {isCompleted && index < currentStep && (
                          <CheckCircle2 className="w-5 h-5 text-primary" />
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Order Items */}
          <Card>
            <CardContent className="p-4">
              <h3 className="font-semibold mb-4">Your Items</h3>
              <div className="space-y-3">
                {currentOrder.items.map((item) => (
                  <div key={item.id} className="flex items-center justify-between py-2 border-b last:border-0">
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{item.quantity}×</span>
                        <span>{item.menu_items?.name}</span>
                      </div>
                      {item.notes && (
                        <p className="text-xs text-muted-foreground mt-1">Note: {item.notes}</p>
                      )}
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-sm text-muted-foreground">
                        ₹{((item.menu_items?.price || 0) * item.quantity).toFixed(0)}
                      </span>
                      <Badge 
                        variant="outline" 
                        className={cn(
                          "text-xs capitalize",
                          item.status === 'pending' && "border-order-pending text-order-pending",
                          item.status === 'preparing' && "border-order-preparing text-order-preparing",
                          item.status === 'ready' && "border-order-ready text-order-ready",
                          item.status === 'served' && "border-order-served text-order-served",
                        )}
                      >
                        {item.status}
                      </Badge>
                    </div>
                  </div>
                ))}
              </div>
              
              <Separator className="my-4" />
              
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Subtotal</span>
                  <span>₹{currentOrder.subtotal.toFixed(0)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Tax (5%)</span>
                  <span>₹{currentOrder.tax.toFixed(0)}</span>
                </div>
                <div className="flex justify-between font-bold text-base pt-2 border-t">
                  <span>Total</span>
                  <span>₹{currentOrder.total.toFixed(0)}</span>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Add More Button */}
          <Button 
            className="w-full" 
            size="lg"
            onClick={() => setCurrentOrder(prev => prev ? { ...prev } : null)}
          >
            <Plus className="w-5 h-5 mr-2" />
            Add More Items
          </Button>
        </div>
      </div>
    );
  }

  // Menu view
  return (
    <div className="min-h-screen bg-background pb-28">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-background/95 backdrop-blur-sm border-b">
        <div className="p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              {currentOrder && (
                <Button 
                  variant="ghost" 
                  size="icon"
                  onClick={() => setCart([])}
                >
                  <ArrowLeft className="w-5 h-5" />
                </Button>
              )}
              <div>
                <h1 className="text-xl font-bold">{restaurantInfo?.name || 'Menu'}</h1>
                {tableInfo && (
                  <p className="text-sm text-muted-foreground flex items-center gap-1">
                    <Utensils className="w-3 h-3" />
                    Table {tableInfo.table_number}
                  </p>
                )}
              </div>
            </div>
            
            <Sheet open={isCartOpen} onOpenChange={setIsCartOpen}>
              <SheetTrigger asChild>
                <Button variant="outline" size="icon" className="relative">
                  <ShoppingCart className="w-5 h-5" />
                  {cartItemCount > 0 && (
                    <span className="absolute -top-2 -right-2 w-5 h-5 rounded-full bg-primary text-primary-foreground text-xs flex items-center justify-center font-medium">
                      {cartItemCount}
                    </span>
                  )}
                </Button>
              </SheetTrigger>
              <SheetContent className="w-full sm:max-w-md flex flex-col">
                <SheetHeader>
                  <SheetTitle className="flex items-center gap-2">
                    <ShoppingCart className="w-5 h-5" />
                    Your Cart
                  </SheetTitle>
                </SheetHeader>
                
                <div className="flex-1 flex flex-col min-h-0 mt-4">
                  {cart.length === 0 ? (
                    <div className="flex-1 flex flex-col items-center justify-center text-center p-6">
                      <ShoppingCart className="w-16 h-16 text-muted-foreground/30 mb-4" />
                      <p className="text-muted-foreground">Your cart is empty</p>
                      <p className="text-sm text-muted-foreground/70 mt-1">Add items from the menu to get started</p>
                    </div>
                  ) : (
                    <>
                      <ScrollArea className="flex-1 -mx-6 px-6">
                        <div className="space-y-4 pb-4">
                          {cart.map((item) => (
                            <Card key={item.menuItem.id} className="overflow-hidden">
                              <CardContent className="p-4">
                                <div className="flex items-start gap-3">
                                  <div className={cn(
                                    "w-4 h-4 rounded border-2 shrink-0 mt-1",
                                    item.menuItem.is_veg 
                                      ? "border-status-available bg-status-available/20" 
                                      : "border-destructive bg-destructive/20"
                                  )} />
                                  <div className="flex-1 min-w-0">
                                    <p className="font-medium truncate">{item.menuItem.name}</p>
                                    <p className="text-sm text-muted-foreground">
                                      ₹{item.menuItem.price} × {item.quantity} = ₹{(item.menuItem.price * item.quantity).toFixed(0)}
                                    </p>
                                    
                                    {/* Notes */}
                                    {activeItemNotes === item.menuItem.id ? (
                                      <div className="mt-2">
                                        <Textarea
                                          placeholder="Add special instructions..."
                                          value={item.notes}
                                          onChange={(e) => updateNotes(item.menuItem.id, e.target.value)}
                                          className="text-sm h-20"
                                        />
                                        <Button 
                                          variant="ghost" 
                                          size="sm" 
                                          className="mt-1"
                                          onClick={() => setActiveItemNotes(null)}
                                        >
                                          Done
                                        </Button>
                                      </div>
                                    ) : (
                                      <Button
                                        variant="ghost"
                                        size="sm"
                                        className="text-xs text-muted-foreground px-0 h-auto mt-1"
                                        onClick={() => setActiveItemNotes(item.menuItem.id)}
                                      >
                                        <MessageSquare className="w-3 h-3 mr-1" />
                                        {item.notes ? 'Edit note' : 'Add note'}
                                      </Button>
                                    )}
                                    {item.notes && activeItemNotes !== item.menuItem.id && (
                                      <p className="text-xs text-muted-foreground mt-1 italic">"{item.notes}"</p>
                                    )}
                                  </div>
                                  
                                  <div className="flex flex-col items-end gap-2">
                                    <Button
                                      size="icon"
                                      variant="ghost"
                                      className="h-6 w-6 text-destructive hover:text-destructive"
                                      onClick={() => removeFromCart(item.menuItem.id)}
                                    >
                                      <Trash2 className="w-4 h-4" />
                                    </Button>
                                    <div className="flex items-center gap-1 bg-muted rounded-full">
                                      <Button
                                        size="icon"
                                        variant="ghost"
                                        className="h-8 w-8 rounded-full"
                                        onClick={() => updateQuantity(item.menuItem.id, -1)}
                                      >
                                        <Minus className="w-4 h-4" />
                                      </Button>
                                      <span className="w-6 text-center font-medium text-sm">{item.quantity}</span>
                                      <Button
                                        size="icon"
                                        variant="ghost"
                                        className="h-8 w-8 rounded-full"
                                        onClick={() => updateQuantity(item.menuItem.id, 1)}
                                      >
                                        <Plus className="w-4 h-4" />
                                      </Button>
                                    </div>
                                  </div>
                                </div>
                              </CardContent>
                            </Card>
                          ))}
                        </div>
                      </ScrollArea>
                      
                      <div className="border-t pt-4 mt-4 space-y-4">
                        <div className="space-y-2">
                          <div className="flex justify-between text-sm">
                            <span className="text-muted-foreground">Subtotal</span>
                            <span>₹{cartTotal.toFixed(0)}</span>
                          </div>
                          <div className="flex justify-between text-sm">
                            <span className="text-muted-foreground">Tax (5%)</span>
                            <span>₹{(cartTotal * 0.05).toFixed(0)}</span>
                          </div>
                          <div className="flex justify-between text-sm">
                            <span className="text-muted-foreground">Service Charge (5%)</span>
                            <span>₹{(cartTotal * 0.05).toFixed(0)}</span>
                          </div>
                          <Separator />
                          <div className="flex justify-between text-lg font-bold">
                            <span>Total</span>
                            <span>₹{(cartTotal * 1.1).toFixed(0)}</span>
                          </div>
                        </div>
                        <Button 
                          className="w-full" 
                          size="lg"
                          onClick={currentOrder ? addToExistingOrder : submitOrder}
                          disabled={submitting}
                        >
                          {submitting ? (
                            <>
                              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                              Placing order...
                            </>
                          ) : currentOrder ? (
                            <>
                              <Plus className="w-4 h-4 mr-2" />
                              Add to Order
                            </>
                          ) : (
                            <>
                              <ChefHat className="w-4 h-4 mr-2" />
                              Place Order
                            </>
                          )}
                        </Button>
                      </div>
                    </>
                  )}
                </div>
              </SheetContent>
            </Sheet>
          </div>
        </div>

        {/* Categories */}
        <ScrollArea className="w-full">
          <div className="flex gap-2 px-4 pb-3">
            {categories.map((category) => (
              <Button
                key={category.id}
                variant={selectedCategory === category.id ? "default" : "outline"}
                size="sm"
                onClick={() => setSelectedCategory(category.id)}
                className={cn(
                  "shrink-0 gap-2",
                  selectedCategory === category.id && "shadow-md"
                )}
              >
                {category.name}
              </Button>
            ))}
          </div>
          <ScrollBar orientation="horizontal" />
        </ScrollArea>
      </div>

      {/* Current Order Banner */}
      {currentOrder && (
        <div className="bg-primary/10 border-b border-primary/20 p-3">
          <div className="flex items-center justify-between max-w-lg mx-auto">
            <div className="flex items-center gap-2">
              <CircleDot className="w-4 h-4 text-primary animate-pulse" />
              <span className="text-sm font-medium">Order #{currentOrder.order_number}</span>
              <Badge variant="outline" className="text-xs capitalize">
                {currentOrder.status}
              </Badge>
            </div>
            <Button 
              variant="ghost" 
              size="sm"
              onClick={() => {
                setCart([]);
              }}
            >
              View Order
            </Button>
          </div>
        </div>
      )}

      {/* Menu Items */}
      <div className="p-4 space-y-3">
        {filteredItems.map((item) => {
          const cartItem = cart.find(c => c.menuItem.id === item.id);
          
          return (
            <Card 
              key={item.id} 
              className={cn(
                "overflow-hidden transition-all duration-200",
                cartItem && "ring-2 ring-primary/50"
              )}
            >
              <CardContent className="p-4">
                <div className="flex gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className={cn(
                        "w-4 h-4 rounded border-2 shrink-0 flex items-center justify-center",
                        item.is_veg 
                          ? "border-status-available" 
                          : "border-destructive"
                      )}>
                        <span className={cn(
                          "w-2 h-2 rounded-full",
                          item.is_veg ? "bg-status-available" : "bg-destructive"
                        )} />
                      </span>
                      <h3 className="font-medium truncate">{item.name}</h3>
                    </div>
                    {item.description && (
                      <p className="text-sm text-muted-foreground line-clamp-2 mb-2">{item.description}</p>
                    )}
                    <div className="flex items-center gap-3">
                      <p className="font-bold text-lg">₹{item.price}</p>
                      {item.preparation_time && (
                        <span className="text-xs text-muted-foreground flex items-center gap-1">
                          <Timer className="w-3 h-3" />
                          {item.preparation_time} min
                        </span>
                      )}
                    </div>
                  </div>
                  
                  <div className="flex flex-col items-end justify-between gap-2">
                    {item.image ? (
                      <div className="w-24 h-24 rounded-xl bg-muted overflow-hidden shadow-sm">
                        <img src={item.image} alt={item.name} className="w-full h-full object-cover" />
                      </div>
                    ) : (
                      <div className="w-24 h-24 rounded-xl bg-muted flex items-center justify-center">
                        <Utensils className="w-8 h-8 text-muted-foreground/30" />
                      </div>
                    )}
                    
                    {cartItem ? (
                      <div className="flex items-center gap-1 bg-primary text-primary-foreground rounded-full shadow-md">
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-8 w-8 rounded-full text-primary-foreground hover:text-primary-foreground hover:bg-primary-foreground/20"
                          onClick={() => updateQuantity(item.id, -1)}
                        >
                          <Minus className="w-4 h-4" />
                        </Button>
                        <span className="w-6 text-center font-medium text-sm">{cartItem.quantity}</span>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-8 w-8 rounded-full text-primary-foreground hover:text-primary-foreground hover:bg-primary-foreground/20"
                          onClick={() => updateQuantity(item.id, 1)}
                        >
                          <Plus className="w-4 h-4" />
                        </Button>
                      </div>
                    ) : (
                      <Button
                        size="sm"
                        className="shadow-md"
                        onClick={() => addToCart(item)}
                      >
                        <Plus className="w-4 h-4 mr-1" />
                        Add
                      </Button>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}

        {filteredItems.length === 0 && (
          <div className="text-center py-16">
            <Utensils className="w-16 h-16 text-muted-foreground/20 mx-auto mb-4" />
            <p className="text-muted-foreground">No items available in this category</p>
          </div>
        )}
      </div>

      {/* Fixed bottom cart summary */}
      {cart.length > 0 && (
        <div className="fixed bottom-0 left-0 right-0 bg-background border-t shadow-lg p-4 safe-area-pb">
          <Button 
            className="w-full shadow-lg" 
            size="lg"
            onClick={() => setIsCartOpen(true)}
          >
            <div className="flex items-center justify-between w-full">
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 rounded-full bg-primary-foreground/20 flex items-center justify-center text-sm font-bold">
                  {cartItemCount}
                </div>
                <span>View Cart</span>
              </div>
              <span className="font-bold">₹{(cartTotal * 1.1).toFixed(0)}</span>
            </div>
          </Button>
        </div>
      )}
    </div>
  );
}
