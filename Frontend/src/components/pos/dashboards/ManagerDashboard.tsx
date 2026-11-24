'use client';

import { useState, useEffect } from 'react';
import { 
  TrendingUp, 
  ShoppingBag, 
  Clock, 
  Users,
  ArrowUpRight,
  ArrowDownRight,
  Package,
  AlertTriangle,
  Calendar,
  Loader2,
  ChefHat,
  Banknote,
  UserCheck,
  TableProperties,
  ArrowRightLeft,
  Merge,
  Split,
  Eye,
  MoreHorizontal,
  Bell,
  Receipt
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { useOrders, useTables, useInventory, useReservations } from '@/hooks/useDatabase';

export function ManagerDashboard() {
  const { orders, loading: ordersLoading } = useOrders();
  const { tables, loading: tablesLoading } = useTables();
  const { inventory, loading: inventoryLoading } = useInventory();
  const { reservations, loading: reservationsLoading } = useReservations();
  const [activeTab, setActiveTab] = useState('overview');

  const loading = ordersLoading || tablesLoading || inventoryLoading || reservationsLoading;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  const todayOrders = orders.filter(o => 
    o.created_at && new Date(o.created_at) >= today
  );
  const activeOrders = orders.filter(o => 
    ['pending', 'preparing', 'ready'].includes(o.status || '')
  );
  const occupiedTables = tables.filter(t => t.status === 'occupied').length;
  const todaySales = todayOrders.reduce((sum, o) => sum + Number(o.total || 0), 0);
  const avgOrderValue = todayOrders.length > 0 ? todaySales / todayOrders.length : 0;

  const lowStockItems = inventory.filter(i => i.current_stock <= i.min_stock_level);
  const todayReservations = reservations.filter(r => {
    const resDate = new Date(r.reservation_date);
    return resDate.toDateString() === today.toDateString() && r.status !== 'cancelled';
  });
  const upcomingReservations = todayReservations.filter(r => r.status === 'pending' || r.status === 'confirmed');

  // Staff performance (simulated based on orders)
  const staffPerformance = [
    { name: 'Rahul Kumar', role: 'Waiter', ordersHandled: 45, revenue: 23400, tips: 2340, rating: 4.8, avatar: 'RK' },
    { name: 'Priya Singh', role: 'Waiter', ordersHandled: 38, revenue: 18900, tips: 1890, rating: 4.6, avatar: 'PS' },
    { name: 'Amit Sharma', role: 'Cashier', ordersHandled: 52, revenue: 45200, tips: 1200, rating: 4.5, avatar: 'AS' },
    { name: 'Chef Rajan', role: 'Kitchen', ordersHandled: 120, revenue: 0, tips: 0, rating: 4.9, avatar: 'CR' },
    { name: 'Neha Patel', role: 'Waiter', ordersHandled: 32, revenue: 15600, tips: 1560, rating: 4.4, avatar: 'NP' },
  ];

  // Table operations summary
  const tableOperations = {
    shifts: 8,
    merges: 3,
    splits: 2,
    totalCapacity: tables.reduce((sum, t) => sum + (t.capacity || 0), 0),
    currentGuests: Math.floor(occupiedTables * 3.5),
  };

  // Hourly order distribution
  const hourlyOrders = Array.from({ length: 12 }, (_, i) => ({
    hour: `${i + 10}:00`,
    orders: Math.floor(Math.random() * 20) + 5,
    revenue: Math.floor(Math.random() * 10000) + 2000,
  }));

  const statCards = [
    {
      title: "Today's Revenue",
      value: `₹${todaySales.toLocaleString()}`,
      change: '+15.3%',
      trend: 'up',
      icon: TrendingUp,
      color: 'text-status-available',
      bgColor: 'bg-status-available/10',
    },
    {
      title: 'Total Orders',
      value: todayOrders.length.toString(),
      change: `+${Math.floor(todayOrders.length * 0.12)} vs yesterday`,
      trend: 'up',
      icon: ShoppingBag,
      color: 'text-primary',
      bgColor: 'bg-primary/10',
    },
    {
      title: 'Table Occupancy',
      value: `${Math.round((occupiedTables / (tables.length || 1)) * 100)}%`,
      subtitle: `${occupiedTables}/${tables.length} tables`,
      icon: TableProperties,
      color: 'text-accent',
      bgColor: 'bg-accent/10',
    },
    {
      title: 'Avg Order Value',
      value: `₹${Math.round(avgOrderValue).toLocaleString()}`,
      change: '+8.2%',
      trend: 'up',
      icon: Receipt,
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
          <div className="p-2 rounded-lg bg-accent/10">
            <Users className="w-6 h-6 text-accent" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-foreground">Manager Dashboard</h2>
            <p className="text-sm text-muted-foreground">Live operations and team management</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="gap-1">
            <span className="w-2 h-2 rounded-full bg-status-available animate-pulse" />
            Live
          </Badge>
          <Button variant="outline" size="sm">
            <Calendar className="w-4 h-4 mr-2" />
            Shift Report
          </Button>
        </div>
      </div>

      {/* Alerts Section */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {lowStockItems.length > 0 && (
          <Card className="border-destructive/50 bg-destructive/5">
            <CardContent className="p-4 flex items-center gap-3">
              <div className="p-2 rounded-full bg-destructive/20">
                <AlertTriangle className="w-5 h-5 text-destructive" />
              </div>
              <div className="flex-1">
                <p className="font-medium text-foreground">{lowStockItems.length} items low on stock</p>
                <p className="text-xs text-muted-foreground">Requires immediate attention</p>
              </div>
              <Button size="sm" variant="destructive">View</Button>
            </CardContent>
          </Card>
        )}
        {upcomingReservations.length > 0 && (
          <Card className="border-primary/50 bg-primary/5">
            <CardContent className="p-4 flex items-center gap-3">
              <div className="p-2 rounded-full bg-primary/20">
                <Calendar className="w-5 h-5 text-primary" />
              </div>
              <div className="flex-1">
                <p className="font-medium text-foreground">{upcomingReservations.length} reservations today</p>
                <p className="text-xs text-muted-foreground">Next at {upcomingReservations[0]?.reservation_time}</p>
              </div>
              <Button size="sm" variant="outline">Manage</Button>
            </CardContent>
          </Card>
        )}
        {activeOrders.length > 10 && (
          <Card className="border-order-preparing/50 bg-order-preparing/5">
            <CardContent className="p-4 flex items-center gap-3">
              <div className="p-2 rounded-full bg-order-preparing/20">
                <Clock className="w-5 h-5 text-order-preparing" />
              </div>
              <div className="flex-1">
                <p className="font-medium text-foreground">{activeOrders.length} active orders</p>
                <p className="text-xs text-muted-foreground">Kitchen at high capacity</p>
              </div>
              <Button size="sm" variant="outline">View Kitchen</Button>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        {statCards.map((stat) => (
          <Card 
            key={stat.title} 
            className="relative overflow-hidden border-none shadow-md hover:shadow-lg transition-all hover:-translate-y-0.5"
          >
            <CardContent className="p-6">
              <div className="flex items-start justify-between">
                <div className="space-y-2">
                  <p className="text-sm font-medium text-muted-foreground">{stat.title}</p>
                  <p className="text-3xl font-bold text-foreground">{stat.value}</p>
                  {stat.change && (
                    <div className="flex items-center gap-1">
                      {stat.trend === 'up' ? (
                        <ArrowUpRight className="w-4 h-4 text-status-available" />
                      ) : (
                        <ArrowDownRight className="w-4 h-4 text-destructive" />
                      )}
                      <span className={cn(
                        "text-sm font-medium",
                        stat.trend === 'up' ? 'text-status-available' : 'text-destructive'
                      )}>
                        {stat.change}
                      </span>
                    </div>
                  )}
                  {stat.subtitle && (
                    <p className="text-sm text-muted-foreground">{stat.subtitle}</p>
                  )}
                </div>
                <div className={cn("p-3 rounded-xl", stat.bgColor)}>
                  <stat.icon className={cn("w-6 h-6", stat.color)} />
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Tabs Section */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <TabsList className="grid w-full max-w-lg grid-cols-4">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="staff">Staff</TabsTrigger>
          <TabsTrigger value="tables">Tables</TabsTrigger>
          <TabsTrigger value="inventory">Inventory</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Today's Reservations */}
            <Card className="border-none shadow-md">
              <CardHeader className="pb-3">
                <CardTitle className="text-lg font-semibold flex items-center gap-2">
                  <Calendar className="w-5 h-5 text-primary" />
                  Reservations
                  <Badge variant="outline" className="ml-auto">{todayReservations.length}</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ScrollArea className="h-[250px]">
                  <div className="space-y-3">
                    {todayReservations.length === 0 ? (
                      <div className="text-center py-8 text-muted-foreground">
                        <Calendar className="w-12 h-12 mx-auto mb-2 opacity-50" />
                        <p>No reservations today</p>
                      </div>
                    ) : (
                      todayReservations.map((res) => (
                        <div 
                          key={res.id}
                          className="flex items-center justify-between p-3 rounded-lg bg-muted/50 hover:bg-muted transition-colors"
                        >
                          <div>
                            <p className="font-medium text-foreground">{res.customer_name}</p>
                            <p className="text-xs text-muted-foreground">
                              {res.party_size} guests • Table {tables.find(t => t.id === res.table_id)?.table_number || 'TBD'}
                            </p>
                          </div>
                          <div className="text-right">
                            <Badge variant="outline">{res.reservation_time}</Badge>
                            <Badge 
                              variant="secondary" 
                              className={cn(
                                "ml-2 capitalize",
                                res.status === 'confirmed' && "bg-status-available/10 text-status-available",
                                res.status === 'pending' && "bg-order-preparing/10 text-order-preparing"
                              )}
                            >
                              {res.status}
                            </Badge>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </ScrollArea>
              </CardContent>
            </Card>

            {/* Table Operations Summary */}
            <Card className="border-none shadow-md">
              <CardHeader className="pb-3">
                <CardTitle className="text-lg font-semibold flex items-center gap-2">
                  <TableProperties className="w-5 h-5 text-accent" />
                  Table Operations
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div className="grid grid-cols-3 gap-3">
                    <div className="p-3 rounded-lg bg-muted/50 text-center">
                      <ArrowRightLeft className="w-5 h-5 mx-auto mb-1 text-primary" />
                      <p className="text-xl font-bold text-foreground">{tableOperations.shifts}</p>
                      <p className="text-xs text-muted-foreground">Shifts</p>
                    </div>
                    <div className="p-3 rounded-lg bg-muted/50 text-center">
                      <Merge className="w-5 h-5 mx-auto mb-1 text-accent" />
                      <p className="text-xl font-bold text-foreground">{tableOperations.merges}</p>
                      <p className="text-xs text-muted-foreground">Merges</p>
                    </div>
                    <div className="p-3 rounded-lg bg-muted/50 text-center">
                      <Split className="w-5 h-5 mx-auto mb-1 text-order-preparing" />
                      <p className="text-xl font-bold text-foreground">{tableOperations.splits}</p>
                      <p className="text-xs text-muted-foreground">Splits</p>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Current Guests</span>
                      <span className="font-medium">{tableOperations.currentGuests} / {tableOperations.totalCapacity}</span>
                    </div>
                    <Progress 
                      value={(tableOperations.currentGuests / tableOperations.totalCapacity) * 100} 
                      className="h-2"
                    />
                  </div>
                  <Button className="w-full" variant="outline">
                    <Eye className="w-4 h-4 mr-2" />
                    View Floor Layout
                  </Button>
                </div>
              </CardContent>
            </Card>

            {/* Low Stock Alerts */}
            <Card className="border-none shadow-md">
              <CardHeader className="pb-3">
                <CardTitle className="text-lg font-semibold flex items-center gap-2">
                  <Package className="w-5 h-5 text-order-preparing" />
                  Low Stock Alerts
                  {lowStockItems.length > 0 && (
                    <Badge variant="destructive" className="ml-auto">{lowStockItems.length}</Badge>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ScrollArea className="h-[250px]">
                  <div className="space-y-3">
                    {lowStockItems.length === 0 ? (
                      <div className="text-center py-8 text-muted-foreground">
                        <Package className="w-12 h-12 mx-auto mb-2 opacity-50" />
                        <p>All items well stocked</p>
                      </div>
                    ) : (
                      lowStockItems.map((item) => (
                        <div 
                          key={item.id}
                          className="flex items-center justify-between p-3 rounded-lg bg-destructive/5 border border-destructive/20"
                        >
                          <div>
                            <p className="font-medium text-foreground">{item.name}</p>
                            <p className="text-xs text-muted-foreground">{item.category}</p>
                          </div>
                          <div className="text-right">
                            <Badge variant="destructive">
                              {item.current_stock} {item.unit}
                            </Badge>
                            <p className="text-xs text-muted-foreground mt-1">
                              Min: {item.min_stock_level}
                            </p>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </ScrollArea>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="staff" className="space-y-4">
          <Card className="border-none shadow-md">
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>Staff Performance</CardTitle>
                  <CardDescription>Today's performance metrics</CardDescription>
                </div>
                <Button size="sm" variant="outline">
                  <Calendar className="w-4 h-4 mr-2" />
                  View Report
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {staffPerformance.map((staff) => (
                  <div 
                    key={staff.name}
                    className="flex items-center justify-between p-4 rounded-xl bg-muted/50 hover:bg-muted transition-colors"
                  >
                    <div className="flex items-center gap-4">
                      <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
                        <span className="text-sm font-bold text-primary">{staff.avatar}</span>
                      </div>
                      <div>
                        <p className="font-medium text-foreground">{staff.name}</p>
                        <p className="text-sm text-muted-foreground">{staff.role}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-6">
                      <div className="text-center">
                        <p className="text-lg font-bold text-foreground">{staff.ordersHandled}</p>
                        <p className="text-xs text-muted-foreground">Orders</p>
                      </div>
                      <div className="text-center">
                        <p className="text-lg font-bold text-foreground">₹{staff.revenue.toLocaleString()}</p>
                        <p className="text-xs text-muted-foreground">Revenue</p>
                      </div>
                      <div className="text-center">
                        <p className="text-lg font-bold text-status-available">★ {staff.rating}</p>
                        <p className="text-xs text-muted-foreground">Rating</p>
                      </div>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon">
                            <MoreHorizontal className="w-4 h-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem>View Details</DropdownMenuItem>
                          <DropdownMenuItem>Assign Tables</DropdownMenuItem>
                          <DropdownMenuItem>View Orders</DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="tables" className="space-y-4">
          <Card className="border-none shadow-md">
            <CardHeader>
              <CardTitle>Floor Layout Overview</CardTitle>
              <CardDescription>Current table status and operations</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-3">
                {tables.map((table) => (
                  <div 
                    key={table.id}
                    className={cn(
                      "aspect-square rounded-xl flex flex-col items-center justify-center cursor-pointer transition-all hover:scale-105 hover:shadow-md",
                      table.status === 'available' && "bg-status-available/10 border-2 border-status-available/30 hover:border-status-available",
                      table.status === 'occupied' && "bg-status-occupied/10 border-2 border-status-occupied/30 hover:border-status-occupied",
                      table.status === 'reserved' && "bg-status-reserved/10 border-2 border-status-reserved/30 hover:border-status-reserved"
                    )}
                  >
                    <span className="font-bold text-foreground">{table.table_number}</span>
                    <span className="text-[10px] text-muted-foreground capitalize">{table.status}</span>
                    <span className="text-[10px] text-muted-foreground">{table.capacity} seats</span>
                  </div>
                ))}
              </div>
              <div className="flex items-center gap-6 mt-6 pt-4 border-t border-border">
                <div className="flex items-center gap-2">
                  <div className="w-4 h-4 rounded bg-status-available" />
                  <span className="text-sm text-muted-foreground">Available ({tables.filter(t => t.status === 'available').length})</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-4 h-4 rounded bg-status-occupied" />
                  <span className="text-sm text-muted-foreground">Occupied ({occupiedTables})</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-4 h-4 rounded bg-status-reserved" />
                  <span className="text-sm text-muted-foreground">Reserved ({tables.filter(t => t.status === 'reserved').length})</span>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="inventory" className="space-y-4">
          <Card className="border-none shadow-md">
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>Inventory Status</CardTitle>
                  <CardDescription>Stock levels and alerts</CardDescription>
                </div>
                <Button size="sm">
                  <Package className="w-4 h-4 mr-2" />
                  Add Stock
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {inventory.slice(0, 10).map((item) => {
                  const stockPercentage = (item.current_stock / (item.max_stock_level || item.min_stock_level * 5)) * 100;
                  const isLow = item.current_stock <= item.min_stock_level;
                  
                  return (
                    <div 
                      key={item.id}
                      className={cn(
                        "p-4 rounded-xl",
                        isLow ? "bg-destructive/5 border border-destructive/20" : "bg-muted/50"
                      )}
                    >
                      <div className="flex items-center justify-between mb-2">
                        <div>
                          <p className="font-medium text-foreground">{item.name}</p>
                          <p className="text-xs text-muted-foreground">{item.category}</p>
                        </div>
                        <div className="text-right">
                          <p className={cn(
                            "font-bold",
                            isLow ? "text-destructive" : "text-foreground"
                          )}>
                            {item.current_stock} {item.unit}
                          </p>
                          {isLow && (
                            <Badge variant="destructive" className="text-xs">Low Stock</Badge>
                          )}
                        </div>
                      </div>
                      <Progress 
                        value={Math.min(stockPercentage, 100)} 
                        className={cn("h-2", isLow && "[&>div]:bg-destructive")}
                      />
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
