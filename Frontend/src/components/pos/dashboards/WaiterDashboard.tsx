'use client';

import { useState } from 'react';
import { 
  ClipboardList, 
  Clock, 
  Users,
  Bell,
  CheckCircle,
  UtensilsCrossed,
  Loader2,
  Plus,
  ArrowRightLeft,
  Merge,
  Eye,
  MoreHorizontal,
  MessageSquare,
  Timer,
  ChefHat,
  ShoppingBag
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { useOrders, useTables } from '@/hooks/useDatabase';

export function WaiterDashboard() {
  const { orders, loading: ordersLoading } = useOrders();
  const { tables, loading: tablesLoading } = useTables();
  const [activeTab, setActiveTab] = useState('active');

  const loading = ordersLoading || tablesLoading;

  const myOrders = orders.filter(o => 
    ['pending', 'preparing', 'ready'].includes(o.status || '')
  );
  const readyOrders = orders.filter(o => o.status === 'ready');
  const pendingOrders = orders.filter(o => o.status === 'pending');
  const preparingOrders = orders.filter(o => o.status === 'preparing');
  const occupiedTables = tables.filter(t => t.status === 'occupied');
  const availableTables = tables.filter(t => t.status === 'available');
  const reservedTables = tables.filter(t => t.status === 'reserved');

  const statCards = [
    {
      title: 'My Active Orders',
      value: myOrders.length.toString(),
      subtitle: 'Currently managing',
      icon: ClipboardList,
      color: 'text-primary',
      bgColor: 'bg-primary/10',
    },
    {
      title: 'Ready to Serve',
      value: readyOrders.length.toString(),
      subtitle: 'Awaiting pickup',
      icon: Bell,
      color: 'text-status-available',
      bgColor: 'bg-status-available/10',
      urgent: readyOrders.length > 0,
    },
    {
      title: 'My Tables',
      value: occupiedTables.length.toString(),
      subtitle: `${availableTables.length} available`,
      icon: Users,
      color: 'text-accent',
      bgColor: 'bg-accent/10',
    },
    {
      title: 'In Kitchen',
      value: (pendingOrders.length + preparingOrders.length).toString(),
      subtitle: 'Being prepared',
      icon: ChefHat,
      color: 'text-order-preparing',
      bgColor: 'bg-order-preparing/10',
    },
  ];

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-primary/10">
            <UtensilsCrossed className="w-6 h-6 text-primary" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-foreground">Waiter Dashboard</h2>
            <p className="text-sm text-muted-foreground">Table service and order management</p>
          </div>
        </div>
        <Button size="sm">
          <Plus className="w-4 h-4 mr-2" />
          New Order
        </Button>
      </div>

      {/* Ready Orders Alert */}
      {readyOrders.length > 0 && (
        <Card className="border-status-available/50 bg-status-available/5 shadow-md">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-full bg-status-available/20 animate-pulse">
                <Bell className="w-5 h-5 text-status-available" />
              </div>
              <div className="flex-1">
                <p className="font-semibold text-foreground">
                  {readyOrders.length} order{readyOrders.length > 1 ? 's' : ''} ready for pickup!
                </p>
                <div className="flex flex-wrap gap-2 mt-1">
                  {readyOrders.slice(0, 5).map(o => (
                    <Badge key={o.id} variant="outline" className="bg-status-available/10 text-status-available border-status-available/30">
                      {o.order_number}
                    </Badge>
                  ))}
                  {readyOrders.length > 5 && (
                    <Badge variant="outline">+{readyOrders.length - 5} more</Badge>
                  )}
                </div>
              </div>
              <Button size="sm" className="bg-status-available hover:bg-status-available/90">
                <Eye className="w-4 h-4 mr-2" />
                View All
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Stats Grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {statCards.map((stat) => (
          <Card 
            key={stat.title} 
            className={cn(
              "relative overflow-hidden border-none shadow-md hover:shadow-lg transition-all hover:-translate-y-0.5",
              stat.urgent && "ring-2 ring-status-available ring-offset-2"
            )}
          >
            <CardContent className="p-5">
              <div className="flex items-start justify-between">
                <div className="space-y-1">
                  <p className="text-xs font-medium text-muted-foreground">{stat.title}</p>
                  <p className="text-2xl font-bold text-foreground">{stat.value}</p>
                  <p className="text-xs text-muted-foreground">{stat.subtitle}</p>
                </div>
                <div className={cn("p-2 rounded-lg", stat.bgColor)}>
                  <stat.icon className={cn("w-5 h-5", stat.color)} />
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Main Content */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Orders Section */}
        <Card className="border-none shadow-md lg:col-span-2">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-lg font-semibold flex items-center gap-2">
                  <ClipboardList className="w-5 h-5 text-primary" />
                  My Orders
                </CardTitle>
              </div>
              <Tabs value={activeTab} onValueChange={setActiveTab}>
                <TabsList className="h-8">
                  <TabsTrigger value="active" className="text-xs">Active ({myOrders.length})</TabsTrigger>
                  <TabsTrigger value="ready" className="text-xs">Ready ({readyOrders.length})</TabsTrigger>
                  <TabsTrigger value="pending" className="text-xs">Kitchen ({pendingOrders.length + preparingOrders.length})</TabsTrigger>
                </TabsList>
              </Tabs>
            </div>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-[400px]">
              <div className="space-y-3">
                {myOrders.length === 0 ? (
                  <div className="text-center py-12 text-muted-foreground">
                    <CheckCircle className="w-16 h-16 mx-auto mb-3 opacity-50" />
                    <p className="text-lg font-medium">No active orders</p>
                    <p className="text-sm">Take a new order to get started</p>
                  </div>
                ) : (
                  myOrders.map((order) => {
                    const createdAt = new Date(order.created_at || Date.now());
                    const waitTime = Math.floor((Date.now() - createdAt.getTime()) / 60000);
                    
                    return (
                      <div 
                        key={order.id}
                        className={cn(
                          "flex items-center justify-between p-4 rounded-xl transition-all hover:shadow-md",
                          order.status === 'ready' 
                            ? "bg-status-available/10 border border-status-available/30" 
                            : order.status === 'preparing'
                            ? "bg-order-preparing/5 border border-order-preparing/20"
                            : "bg-muted/50 hover:bg-muted"
                        )}
                      >
                        <div className="flex items-center gap-4">
                          <div className={cn(
                            "w-14 h-14 rounded-xl flex flex-col items-center justify-center",
                            order.status === 'ready' ? "bg-status-available/20" :
                            order.status === 'preparing' ? "bg-order-preparing/20" :
                            "bg-primary/10"
                          )}>
                            <span className="font-bold text-foreground">
                              {order.table_id ? `T${order.table_id.slice(-2)}` : 'TW'}
                            </span>
                            <span className="text-[10px] text-muted-foreground capitalize">
                              {order.order_type?.replace('_', ' ')}
                            </span>
                          </div>
                          <div>
                            <div className="flex items-center gap-2">
                              <p className="font-semibold text-foreground">{order.order_number}</p>
                              {order.status === 'ready' && (
                                <Bell className="w-4 h-4 text-status-available animate-pulse" />
                              )}
                            </div>
                            <p className="text-sm text-muted-foreground">
                              {(order.order_items || []).length} items • ₹{Number(order.total || 0).toLocaleString()}
                            </p>
                            <div className="flex items-center gap-2 mt-1">
                              <Timer className={cn(
                                "w-3 h-3",
                                waitTime > 20 ? "text-destructive" : 
                                waitTime > 10 ? "text-order-preparing" : 
                                "text-muted-foreground"
                              )} />
                              <span className={cn(
                                "text-xs",
                                waitTime > 20 ? "text-destructive font-medium" : 
                                waitTime > 10 ? "text-order-preparing font-medium" : 
                                "text-muted-foreground"
                              )}>
                                {waitTime} min
                              </span>
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge 
                            variant="outline"
                            className={cn(
                              "capitalize",
                              order.status === 'pending' && "bg-order-pending/10 text-order-pending border-order-pending/30",
                              order.status === 'preparing' && "bg-order-preparing/10 text-order-preparing border-order-preparing/30",
                              order.status === 'ready' && "bg-order-ready/10 text-order-ready border-order-ready/30",
                            )}
                          >
                            {order.status}
                          </Badge>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon" className="h-8 w-8">
                                <MoreHorizontal className="w-4 h-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem>
                                <Eye className="w-4 h-4 mr-2" />
                                View Details
                              </DropdownMenuItem>
                              <DropdownMenuItem>
                                <Plus className="w-4 h-4 mr-2" />
                                Add Items
                              </DropdownMenuItem>
                              <DropdownMenuItem>
                                <MessageSquare className="w-4 h-4 mr-2" />
                                Add Note
                              </DropdownMenuItem>
                              {order.status === 'ready' && (
                                <DropdownMenuItem className="text-status-available">
                                  <CheckCircle className="w-4 h-4 mr-2" />
                                  Mark Served
                                </DropdownMenuItem>
                              )}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>

        {/* Right Column */}
        <div className="space-y-6">
          {/* Table Overview */}
          <Card className="border-none shadow-md">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-lg font-semibold flex items-center gap-2">
                  <Users className="w-5 h-5 text-accent" />
                  My Tables
                </CardTitle>
                <Button variant="ghost" size="sm">
                  <Eye className="w-4 h-4 mr-1" />
                  View All
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-4 gap-2">
                {tables.slice(0, 12).map((table) => (
                  <div 
                    key={table.id}
                    className={cn(
                      "aspect-square rounded-lg flex flex-col items-center justify-center cursor-pointer transition-all hover:scale-105 hover:shadow-md",
                      table.status === 'available' && "bg-status-available/10 border-2 border-status-available/30 hover:border-status-available",
                      table.status === 'occupied' && "bg-status-occupied/10 border-2 border-status-occupied/30 hover:border-status-occupied",
                      table.status === 'reserved' && "bg-status-reserved/10 border-2 border-status-reserved/30 hover:border-status-reserved"
                    )}
                  >
                    <span className="font-bold text-foreground text-sm">{table.table_number}</span>
                    <span className="text-[9px] text-muted-foreground capitalize">{table.status}</span>
                  </div>
                ))}
              </div>
              <div className="flex items-center justify-between gap-2 mt-4 pt-4 border-t border-border text-xs">
                <div className="flex items-center gap-1">
                  <div className="w-2 h-2 rounded-full bg-status-available" />
                  <span className="text-muted-foreground">{availableTables.length}</span>
                </div>
                <div className="flex items-center gap-1">
                  <div className="w-2 h-2 rounded-full bg-status-occupied" />
                  <span className="text-muted-foreground">{occupiedTables.length}</span>
                </div>
                <div className="flex items-center gap-1">
                  <div className="w-2 h-2 rounded-full bg-status-reserved" />
                  <span className="text-muted-foreground">{reservedTables.length}</span>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Quick Actions */}
          <Card className="border-none shadow-md">
            <CardHeader className="pb-3">
              <CardTitle className="text-lg font-semibold">Quick Actions</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-3">
                <Button variant="outline" className="h-16 flex-col gap-1">
                  <Plus className="w-5 h-5" />
                  <span className="text-xs">New Order</span>
                </Button>
                <Button variant="outline" className="h-16 flex-col gap-1">
                  <ArrowRightLeft className="w-5 h-5" />
                  <span className="text-xs">Shift Table</span>
                </Button>
                <Button variant="outline" className="h-16 flex-col gap-1">
                  <Merge className="w-5 h-5" />
                  <span className="text-xs">Merge Tables</span>
                </Button>
                <Button variant="outline" className="h-16 flex-col gap-1">
                  <ShoppingBag className="w-5 h-5" />
                  <span className="text-xs">Takeaway</span>
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Recent Activity */}
          <Card className="border-none shadow-md">
            <CardHeader className="pb-3">
              <CardTitle className="text-lg font-semibold flex items-center gap-2">
                <Clock className="w-5 h-5 text-muted-foreground" />
                Recent Activity
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {orders.slice(0, 4).map((order, idx) => (
                  <div key={order.id} className="flex items-center gap-3 text-sm">
                    <div className={cn(
                      "w-2 h-2 rounded-full",
                      idx === 0 ? "bg-status-available" : "bg-muted-foreground/50"
                    )} />
                    <div className="flex-1 truncate">
                      <span className="font-medium">{order.order_number}</span>
                      <span className="text-muted-foreground"> - {order.status}</span>
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {new Date(order.created_at || Date.now()).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
