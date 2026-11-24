'use client';

import { 
  TrendingUp, 
  ShoppingBag, 
  Clock, 
  Users,
  ArrowUpRight,
  ArrowDownRight,
  Utensils,
  Loader2
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { useOrders, useTables } from '@/hooks/useDatabase';

export function Dashboard() {
  const { orders, loading: ordersLoading } = useOrders();
  const { tables, loading: tablesLoading } = useTables();

  const loading = ordersLoading || tablesLoading;

  // Calculate stats
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

  // Calculate top selling items
  const itemCounts: Record<string, { name: string; quantity: number }> = {};
  todayOrders.forEach(order => {
    (order.order_items || []).forEach(item => {
      const itemName = item.menu_items?.name || 'Unknown';
      if (!itemCounts[item.menu_item_id]) {
        itemCounts[item.menu_item_id] = { name: itemName, quantity: 0 };
      }
      itemCounts[item.menu_item_id].quantity += item.quantity || 1;
    });
  });
  
  const topSellingItems = Object.values(itemCounts)
    .sort((a, b) => b.quantity - a.quantity)
    .slice(0, 5);

  const recentOrders = orders.slice(0, 5);

  const statCards = [
    {
      title: "Today's Sales",
      value: `₹${todaySales.toLocaleString()}`,
      change: '+12.5%',
      trend: 'up',
      icon: TrendingUp,
      color: 'text-status-available',
      bgColor: 'bg-status-available/10',
    },
    {
      title: 'Total Orders',
      value: todayOrders.length.toString(),
      change: '+8.2%',
      trend: 'up',
      icon: ShoppingBag,
      color: 'text-primary',
      bgColor: 'bg-primary/10',
    },
    {
      title: 'Active Orders',
      value: activeOrders.length.toString(),
      subtitle: 'In progress',
      icon: Clock,
      color: 'text-order-preparing',
      bgColor: 'bg-order-preparing/10',
    },
    {
      title: 'Table Occupancy',
      value: `${occupiedTables}/${tables.length}`,
      percentage: tables.length > 0 ? Math.round((occupiedTables / tables.length) * 100) : 0,
      icon: Users,
      color: 'text-accent',
      bgColor: 'bg-accent/10',
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
      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        {statCards.map((stat, index) => (
          <Card 
            key={stat.title} 
            className="relative overflow-hidden border-none shadow-md hover:shadow-lg transition-shadow"
            style={{ animationDelay: `${index * 100}ms` }}
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
                      <span className="text-sm text-muted-foreground">vs yesterday</span>
                    </div>
                  )}
                  {stat.subtitle && (
                    <p className="text-sm text-muted-foreground">{stat.subtitle}</p>
                  )}
                  {stat.percentage !== undefined && (
                    <div className="space-y-1">
                      <div className="h-2 bg-muted rounded-full overflow-hidden">
                        <div 
                          className="h-full bg-accent rounded-full transition-all duration-500"
                          style={{ width: `${stat.percentage}%` }}
                        />
                      </div>
                      <p className="text-sm text-muted-foreground">{stat.percentage}% occupied</p>
                    </div>
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

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Recent Orders */}
        <Card className="border-none shadow-md">
          <CardHeader className="pb-3">
            <CardTitle className="text-lg font-semibold flex items-center gap-2">
              <Clock className="w-5 h-5 text-primary" />
              Recent Orders
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {recentOrders.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  No orders yet
                </div>
              ) : (
                recentOrders.map((order) => (
                  <div 
                    key={order.id}
                    className="flex items-center justify-between p-4 rounded-xl bg-muted/50 hover:bg-muted transition-colors"
                  >
                    <div className="flex items-center gap-4">
                      <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center">
                        <span className="font-bold text-primary font-mono">
                          {order.table_id ? `T${order.table_id.slice(-2)}` : 'TW'}
                        </span>
                      </div>
                      <div>
                        <p className="font-semibold text-foreground">{order.order_number}</p>
                        <p className="text-sm text-muted-foreground">
                          {(order.order_items || []).length} items • {(order.order_type || 'dine_in').replace('_', ' ')}
                        </p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="font-bold text-foreground">₹{Number(order.total || 0).toFixed(0)}</p>
                      <Badge 
                        variant="outline"
                        className={cn(
                          "capitalize",
                          order.status === 'pending' && "bg-order-pending/10 text-order-pending border-order-pending/30",
                          order.status === 'preparing' && "bg-order-preparing/10 text-order-preparing border-order-preparing/30",
                          order.status === 'ready' && "bg-order-ready/10 text-order-ready border-order-ready/30",
                          order.status === 'served' && "bg-order-served/10 text-order-served border-order-served/30",
                        )}
                      >
                        {order.status}
                      </Badge>
                    </div>
                  </div>
                ))
              )}
            </div>
          </CardContent>
        </Card>

        {/* Top Selling Items */}
        <Card className="border-none shadow-md">
          <CardHeader className="pb-3">
            <CardTitle className="text-lg font-semibold flex items-center gap-2">
              <Utensils className="w-5 h-5 text-accent" />
              Top Selling Items
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {topSellingItems.length > 0 ? (
                topSellingItems.map((item, index) => (
                  <div 
                    key={item.name}
                    className="flex items-center gap-4"
                  >
                    <div className={cn(
                      "w-8 h-8 rounded-lg flex items-center justify-center font-bold text-sm",
                      index === 0 && "bg-accent text-accent-foreground",
                      index === 1 && "bg-primary text-primary-foreground",
                      index === 2 && "bg-secondary text-secondary-foreground",
                      index > 2 && "bg-muted text-muted-foreground"
                    )}>
                      {index + 1}
                    </div>
                    <div className="flex-1">
                      <p className="font-medium text-foreground">{item.name}</p>
                      <div className="h-2 bg-muted rounded-full mt-1 overflow-hidden">
                        <div 
                          className="h-full bg-primary rounded-full"
                          style={{ 
                            width: `${(item.quantity / (topSellingItems[0]?.quantity || 1)) * 100}%` 
                          }}
                        />
                      </div>
                    </div>
                    <div className="text-right">
                      <span className="font-bold text-foreground">{item.quantity}</span>
                      <span className="text-muted-foreground text-sm ml-1">sold</span>
                    </div>
                  </div>
                ))
              ) : (
                <div className="text-center py-8 text-muted-foreground">
                  No sales data for today
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
