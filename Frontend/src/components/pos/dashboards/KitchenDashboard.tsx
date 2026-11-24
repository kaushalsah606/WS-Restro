'use client';

import { useState } from 'react';
import { 
  ChefHat, 
  Clock, 
  Flame,
  CheckCircle,
  AlertCircle,
  Timer,
  Utensils,
  Loader2,
  Bell,
  Printer,
  Filter,
  MoreHorizontal,
  Eye,
  Play,
  Pause
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
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { useOrders } from '@/hooks/useDatabase';

export function KitchenDashboard() {
  const { orders, updateOrderStatus, loading } = useOrders();
  const [activeTab, setActiveTab] = useState('all');
  const [courseFilter, setCourseFilter] = useState<string | null>(null);

  const pendingOrders = orders.filter(o => o.status === 'pending');
  const preparingOrders = orders.filter(o => o.status === 'preparing');
  const readyOrders = orders.filter(o => o.status === 'ready');
  
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const completedToday = orders.filter(o => 
    ['served', 'completed'].includes(o.status || '') && 
    o.updated_at && new Date(o.updated_at) >= today
  ).length;

  // Calculate items
  const totalPendingItems = pendingOrders.reduce((sum, o) => 
    sum + (o.order_items || []).reduce((itemSum, item) => itemSum + (item.quantity || 1), 0), 0
  );
  const totalPreparingItems = preparingOrders.reduce((sum, o) => 
    sum + (o.order_items || []).reduce((itemSum, item) => itemSum + (item.quantity || 1), 0), 0
  );

  // Course-wise breakdown
  const courses = ['starter', 'main', 'dessert', 'beverage'];
  const courseStats = courses.map(course => ({
    name: course,
    count: [...pendingOrders, ...preparingOrders].reduce((sum, o) => 
      sum + (o.order_items || []).filter(item => (item.course || 'main') === course).length, 0
    ),
  }));

  const statCards = [
    {
      title: 'Pending Orders',
      value: pendingOrders.length.toString(),
      subtitle: `${totalPendingItems} items`,
      icon: Clock,
      color: 'text-order-pending',
      bgColor: 'bg-order-pending/10',
      urgent: pendingOrders.length > 5,
    },
    {
      title: 'In Preparation',
      value: preparingOrders.length.toString(),
      subtitle: `${totalPreparingItems} items cooking`,
      icon: Flame,
      color: 'text-order-preparing',
      bgColor: 'bg-order-preparing/10',
    },
    {
      title: 'Ready to Serve',
      value: readyOrders.length.toString(),
      subtitle: 'Awaiting pickup',
      icon: Bell,
      color: 'text-order-ready',
      bgColor: 'bg-order-ready/10',
    },
    {
      title: 'Completed Today',
      value: completedToday.toString(),
      subtitle: 'Orders served',
      icon: CheckCircle,
      color: 'text-status-available',
      bgColor: 'bg-status-available/10',
    },
  ];

  // Build order queue with timing
  const orderQueue = [...pendingOrders, ...preparingOrders].map(order => {
    const createdAt = new Date(order.created_at || Date.now());
    const waitTime = Math.round((Date.now() - createdAt.getTime()) / 60000);
    return {
      ...order,
      waitTime,
      isUrgent: waitTime > 15,
      isCritical: waitTime > 25,
    };
  }).sort((a, b) => b.waitTime - a.waitTime);

  const handleStartPreparing = async (orderId: string) => {
    await updateOrderStatus(orderId, 'preparing');
  };

  const handleMarkReady = async (orderId: string) => {
    await updateOrderStatus(orderId, 'ready');
  };

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
          <div className="p-2 rounded-lg bg-order-preparing/10">
            <ChefHat className="w-6 h-6 text-order-preparing" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-foreground">Kitchen Display System</h2>
            <p className="text-sm text-muted-foreground">Order preparation and queue management</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="gap-1">
            <span className="w-2 h-2 rounded-full bg-status-available animate-pulse" />
            Live
          </Badge>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm">
                <Filter className="w-4 h-4 mr-2" />
                Filter
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => setCourseFilter(null)}>
                All Courses
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              {courses.map(course => (
                <DropdownMenuItem 
                  key={course} 
                  onClick={() => setCourseFilter(course)}
                  className="capitalize"
                >
                  {course}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <Button variant="outline" size="sm">
            <Printer className="w-4 h-4 mr-2" />
            Print KOT
          </Button>
        </div>
      </div>

      {/* Urgent Alert */}
      {orderQueue.filter(o => o.isCritical).length > 0 && (
        <Card className="border-destructive/50 bg-destructive/5 shadow-md">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-full bg-destructive/20 animate-pulse">
                <AlertCircle className="w-5 h-5 text-destructive" />
              </div>
              <div className="flex-1">
                <p className="font-semibold text-foreground">
                  {orderQueue.filter(o => o.isCritical).length} orders waiting over 25 minutes!
                </p>
                <p className="text-sm text-muted-foreground">
                  Prioritize these orders immediately
                </p>
              </div>
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
              stat.urgent && "ring-2 ring-destructive ring-offset-2"
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

      {/* Course-wise Stats */}
      <div className="flex items-center gap-4 p-4 bg-muted/30 rounded-xl">
        <span className="text-sm font-medium text-muted-foreground">Course Queue:</span>
        {courseStats.map(course => (
          <Badge 
            key={course.name}
            variant={courseFilter === course.name ? "default" : "outline"}
            className={cn(
              "cursor-pointer capitalize transition-all hover:scale-105",
              courseFilter === course.name && "bg-primary"
            )}
            onClick={() => setCourseFilter(courseFilter === course.name ? null : course.name)}
          >
            {course.name}: {course.count}
          </Badge>
        ))}
      </div>

      {/* Order Queue */}
      <Card className="border-none shadow-md">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-lg font-semibold flex items-center gap-2">
                <Clock className="w-5 h-5 text-primary" />
                Order Queue
              </CardTitle>
              <CardDescription>Sorted by wait time (oldest first)</CardDescription>
            </div>
            <Tabs value={activeTab} onValueChange={setActiveTab}>
              <TabsList className="h-8">
                <TabsTrigger value="all" className="text-xs">All ({orderQueue.length})</TabsTrigger>
                <TabsTrigger value="pending" className="text-xs">Pending ({pendingOrders.length})</TabsTrigger>
                <TabsTrigger value="preparing" className="text-xs">Cooking ({preparingOrders.length})</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
        </CardHeader>
        <CardContent>
          <ScrollArea className="h-[500px]">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {orderQueue.length === 0 ? (
                <div className="col-span-full text-center py-16 text-muted-foreground">
                  <ChefHat className="w-20 h-20 mx-auto mb-4 opacity-50" />
                  <p className="text-xl font-medium">All caught up!</p>
                  <p className="text-sm">No pending orders in the queue</p>
                </div>
              ) : (
                orderQueue
                  .filter(o => activeTab === 'all' || o.status === activeTab)
                  .map((order) => (
                    <Card 
                      key={order.id}
                      className={cn(
                        "relative overflow-hidden transition-all hover:shadow-lg",
                        order.isCritical && "border-destructive bg-destructive/5",
                        order.isUrgent && !order.isCritical && "border-order-preparing bg-order-preparing/5",
                        order.status === 'preparing' && !order.isUrgent && "border-order-preparing/50 bg-order-preparing/5"
                      )}
                    >
                      {/* Status indicator bar */}
                      <div className={cn(
                        "absolute top-0 left-0 right-0 h-1",
                        order.isCritical && "bg-destructive",
                        order.isUrgent && !order.isCritical && "bg-order-preparing",
                        !order.isUrgent && order.status === 'pending' && "bg-order-pending",
                        !order.isUrgent && order.status === 'preparing' && "bg-order-preparing"
                      )} />
                      
                      <CardContent className="p-4 pt-5">
                        {/* Header */}
                        <div className="flex items-start justify-between mb-3">
                          <div>
                            <div className="flex items-center gap-2">
                              <p className="font-bold text-foreground">{order.order_number}</p>
                              {order.isCritical && (
                                <Badge variant="destructive" className="text-xs animate-pulse">URGENT</Badge>
                              )}
                            </div>
                            <p className="text-xs text-muted-foreground">
                              Table {order.table_id ? `T${order.table_id.slice(-2)}` : 'Takeaway'}
                            </p>
                          </div>
                          <Badge 
                            variant="outline"
                            className={cn(
                              "capitalize",
                              order.status === 'pending' && "bg-order-pending/10 text-order-pending border-order-pending/30",
                              order.status === 'preparing' && "bg-order-preparing/10 text-order-preparing border-order-preparing/30",
                            )}
                          >
                            {order.status === 'preparing' ? 'Cooking' : order.status}
                          </Badge>
                        </div>
                        
                        {/* Items */}
                        <div className="space-y-2 mb-4">
                          {(order.order_items || [])
                            .filter(item => !courseFilter || (item.course || 'main') === courseFilter)
                            .slice(0, 4)
                            .map((item, idx) => (
                              <div key={idx} className="flex items-center gap-2 text-sm">
                                <span className={cn(
                                  "w-6 h-6 rounded flex items-center justify-center text-xs font-bold",
                                  item.status === 'preparing' ? "bg-order-preparing/20 text-order-preparing" :
                                  item.status === 'ready' ? "bg-status-available/20 text-status-available" :
                                  "bg-muted text-muted-foreground"
                                )}>
                                  {item.quantity}
                                </span>
                                <span className="text-foreground truncate flex-1">
                                  {item.menu_items?.name || 'Item'}
                                </span>
                                {item.notes && (
                                  <Badge variant="outline" className="text-[10px]">Note</Badge>
                                )}
                              </div>
                            ))}
                          {(order.order_items || []).length > 4 && (
                            <p className="text-xs text-muted-foreground pl-8">
                              +{(order.order_items || []).length - 4} more items
                            </p>
                          )}
                        </div>

                        {/* Timer & Actions */}
                        <div className="flex items-center justify-between pt-3 border-t border-border">
                          <div className="flex items-center gap-2">
                            <Timer className={cn(
                              "w-4 h-4",
                              order.isCritical ? "text-destructive" :
                              order.isUrgent ? "text-order-preparing" :
                              "text-muted-foreground"
                            )} />
                            <span className={cn(
                              "text-sm font-bold",
                              order.isCritical ? "text-destructive" :
                              order.isUrgent ? "text-order-preparing" :
                              "text-muted-foreground"
                            )}>
                              {order.waitTime}m
                            </span>
                          </div>
                          <div className="flex items-center gap-1">
                            {order.status === 'pending' && (
                              <Button 
                                size="sm" 
                                className="h-7 text-xs"
                                onClick={() => handleStartPreparing(order.id)}
                              >
                                <Play className="w-3 h-3 mr-1" />
                                Start
                              </Button>
                            )}
                            {order.status === 'preparing' && (
                              <Button 
                                size="sm" 
                                className="h-7 text-xs bg-status-available hover:bg-status-available/90"
                                onClick={() => handleMarkReady(order.id)}
                              >
                                <CheckCircle className="w-3 h-3 mr-1" />
                                Ready
                              </Button>
                            )}
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="icon" className="h-7 w-7">
                                  <MoreHorizontal className="w-4 h-4" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuItem>
                                  <Eye className="w-4 h-4 mr-2" />
                                  View Details
                                </DropdownMenuItem>
                                <DropdownMenuItem>
                                  <Printer className="w-4 h-4 mr-2" />
                                  Re-print KOT
                                </DropdownMenuItem>
                                <DropdownMenuItem>
                                  <Pause className="w-4 h-4 mr-2" />
                                  Hold Order
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))
              )}
            </div>
          </ScrollArea>
        </CardContent>
      </Card>
    </div>
  );
}
