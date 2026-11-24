'use client';

import { useState, useEffect } from 'react';
import { cn } from '@/lib/utils';
import { 
  TrendingUp, 
  DollarSign, 
  ShoppingBag, 
  Clock, 
  Users,
  Calendar,
  BarChart3,
  Loader2,
  ArrowUp,
  ArrowDown,
  Download,
  FileSpreadsheet,
  ChefHat,
  CreditCard,
  Percent,
  Target,
  Layers,
  PieChart as PieChartIcon,
  Package
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
  LineChart,
  Line,
  ComposedChart,
  RadarChart,
  Radar,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis
} from 'recharts';
import { apiClient, errorMessage } from '@/lib/api-client';
import { format, subDays, parseISO, getDay, getHours } from 'date-fns';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { toast } from 'sonner';

interface SalesData {
  date: string;
  revenue: number;
  orders: number;
  avgOrderValue: number;
}

interface CategoryData {
  name: string;
  revenue: number;
  orders: number;
  items: number;
}

interface ItemSalesData {
  name: string;
  category: string;
  quantity: number;
  revenue: number;
  avgPrice: number;
}

interface PaymentData {
  method: string;
  amount: number;
  count: number;
}

interface HourlyData {
  hour: string;
  orders: number;
  revenue: number;
}

interface WeekdayData {
  day: string;
  revenue: number;
  orders: number;
}

interface WaiterPerformance {
  id: string;
  name: string;
  orders: number;
  revenue: number;
  avgOrderValue: number;
  itemsSold: number;
}

interface TablePerformance {
  tableNumber: string;
  orders: number;
  revenue: number;
  turnoverTime: number;
}

const COLORS = [
  'hsl(var(--primary))', 
  'hsl(var(--chart-2))', 
  'hsl(var(--chart-3))', 
  'hsl(var(--chart-4))', 
  'hsl(var(--chart-5))',
  '#8884d8',
  '#82ca9d',
  '#ffc658'
];

export function DetailedReports() {
  const [loading, setLoading] = useState(true);
  const [dateRange, setDateRange] = useState<'today' | 'week' | 'month' | 'quarter'>('week');
  const [activeTab, setActiveTab] = useState('overview');
  
  // Data states
  const [salesData, setSalesData] = useState<SalesData[]>([]);
  const [categoryData, setCategoryData] = useState<CategoryData[]>([]);
  const [itemSalesData, setItemSalesData] = useState<ItemSalesData[]>([]);
  const [paymentData, setPaymentData] = useState<PaymentData[]>([]);
  const [hourlyData, setHourlyData] = useState<HourlyData[]>([]);
  const [weekdayData, setWeekdayData] = useState<WeekdayData[]>([]);
  const [waiterData, setWaiterData] = useState<WaiterPerformance[]>([]);
  const [tableData, setTableData] = useState<TablePerformance[]>([]);
  
  const [stats, setStats] = useState({
    totalRevenue: 0,
    totalOrders: 0,
    avgOrderValue: 0,
    growthRate: 0,
    topCategory: '',
    peakHour: '',
    conversionRate: 0,
    returningCustomers: 0
  });

  useEffect(() => {
    fetchAllAnalytics();
  }, [dateRange]);

  const fetchAllAnalytics = async () => {
    setLoading(true);
    try {
      const days = dateRange === 'today' ? 1 : dateRange === 'week' ? 7 : dateRange === 'month' ? 30 : 90;
      const startDate = subDays(new Date(), days);

      // Parallel fetch all data from the backend API (snake_case rows, matching this screen's field names)
      const range = { start_date: startDate.toISOString() };
      const [billsRes, ordersRes, orderItemsRes, paymentsRes, usersRes] = await Promise.all([
        apiClient.snake.get<any[]>('/billing', { ...range, status: 'completed', limit: 1000 }),
        apiClient.snake.get<any[]>('/orders', { ...range, limit: 1000 }),
        apiClient.snake.get<any[]>('/orders/items', range),
        apiClient.snake.get<any[]>('/payments', { ...range, limit: 1000 }),
        apiClient.snake.get<any[]>('/auth/users', { limit: 500 }),
      ]);

      const bills = billsRes || [];
      const orders = ordersRes || [];
      const orderItems = orderItemsRes || [];
      const payments = paymentsRes || [];
      const profiles = usersRes || [];
      
      const waiterMap = new Map(profiles.map(p => [p.id, p.full_name || 'Unknown']));

      // Process Sales Data by Date
      const salesByDate: Record<string, { revenue: number; orders: number }> = {};
      for (let i = 0; i < days; i++) {
        const date = format(subDays(new Date(), days - 1 - i), 'yyyy-MM-dd');
        salesByDate[date] = { revenue: 0, orders: 0 };
      }

      bills.forEach(bill => {
        const date = format(parseISO(bill.generated_at), 'yyyy-MM-dd');
        if (salesByDate[date]) {
          salesByDate[date].revenue += Number(bill.total) || 0;
          salesByDate[date].orders += 1;
        }
      });

      const processedSalesData = Object.entries(salesByDate).map(([date, data]) => ({
        date: format(parseISO(date), 'MMM dd'),
        revenue: data.revenue,
        orders: data.orders,
        avgOrderValue: data.orders > 0 ? data.revenue / data.orders : 0
      }));
      setSalesData(processedSalesData);

      // Process Category Data and Item Sales Data
      const categoryStats: Record<string, { revenue: number; orders: Set<string>; items: number }> = {};
      const itemStats: Record<string, { name: string; category: string; quantity: number; revenue: number; prices: number[] }> = {};
      
      orderItems.forEach(item => {
        const menuItem = Array.isArray(item.menu_item) ? item.menu_item[0] : item.menu_item;
        const category = menuItem?.category ?? menuItem?.categories;
        const categoryName = Array.isArray(category) ? category[0]?.name : (category as any)?.name || 'Uncategorized';
        const itemName = menuItem?.name || 'Unknown Item';
        const itemId = menuItem?.id || itemName;
        
        // Category stats
        if (categoryName) {
          if (!categoryStats[categoryName]) {
            categoryStats[categoryName] = { revenue: 0, orders: new Set(), items: 0 };
          }
          categoryStats[categoryName].revenue += Number(item.total) || 0;
          categoryStats[categoryName].items += item.quantity || 0;
        }
        
        // Item stats
        if (!itemStats[itemId]) {
          itemStats[itemId] = { name: itemName, category: categoryName, quantity: 0, revenue: 0, prices: [] };
        }
        itemStats[itemId].quantity += item.quantity || 0;
        itemStats[itemId].revenue += Number(item.total) || 0;
        if (item.unit_price) itemStats[itemId].prices.push(Number(item.unit_price));
      });

      const processedCategoryData = Object.entries(categoryStats)
        .map(([name, data]) => ({
          name,
          revenue: data.revenue,
          orders: data.orders.size,
          items: data.items
        }))
        .sort((a, b) => b.revenue - a.revenue)
        .slice(0, 8);
      setCategoryData(processedCategoryData);
      
      const processedItemData = Object.values(itemStats)
        .map(item => ({
          name: item.name,
          category: item.category,
          quantity: item.quantity,
          revenue: item.revenue,
          avgPrice: item.prices.length > 0 ? item.prices.reduce((a, b) => a + b, 0) / item.prices.length : 0
        }))
        .sort((a, b) => b.revenue - a.revenue);
      setItemSalesData(processedItemData);

      // Process Payment Data
      const paymentStats: Record<string, { amount: number; count: number }> = {
        cash: { amount: 0, count: 0 },
        card: { amount: 0, count: 0 },
        upi: { amount: 0, count: 0 },
        wallet: { amount: 0, count: 0 }
      };

      payments.forEach(payment => {
        if (paymentStats[payment.method]) {
          paymentStats[payment.method].amount += Number(payment.amount) || 0;
          paymentStats[payment.method].count += 1;
        }
      });

      setPaymentData(Object.entries(paymentStats).map(([method, data]) => ({
        method: method.charAt(0).toUpperCase() + method.slice(1),
        amount: data.amount,
        count: data.count
      })));

      // Process Hourly Data
      const hourlyStats: Record<number, { orders: number; revenue: number }> = {};
      for (let h = 0; h < 24; h++) {
        hourlyStats[h] = { orders: 0, revenue: 0 };
      }

      orders.forEach(order => {
        const hour = getHours(parseISO(order.created_at));
        hourlyStats[hour].orders += 1;
        hourlyStats[hour].revenue += Number(order.total) || 0;
      });

      setHourlyData(
        Object.entries(hourlyStats)
          .filter(([h]) => Number(h) >= 8 && Number(h) <= 23)
          .map(([hour, data]) => ({
            hour: `${hour}:00`,
            orders: data.orders,
            revenue: data.revenue
          }))
      );

      // Process Weekday Data
      const weekdayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
      const weekdayStats: Record<number, { revenue: number; orders: number }> = {};
      for (let d = 0; d < 7; d++) {
        weekdayStats[d] = { revenue: 0, orders: 0 };
      }

      orders.forEach(order => {
        const day = getDay(parseISO(order.created_at));
        weekdayStats[day].orders += 1;
        weekdayStats[day].revenue += Number(order.total) || 0;
      });

      setWeekdayData(weekdayNames.map((name, i) => ({
        day: name,
        revenue: weekdayStats[i].revenue,
        orders: weekdayStats[i].orders
      })));

      // Calculate Stats
      const totalRevenue = bills.reduce((sum, b) => sum + (Number(b.total) || 0), 0);
      const totalOrders = bills.length;
      const avgOrderValue = totalOrders > 0 ? totalRevenue / totalOrders : 0;

      // Calculate growth rate
      const midPoint = Math.floor(processedSalesData.length / 2);
      const firstHalf = processedSalesData.slice(0, midPoint).reduce((s, d) => s + d.revenue, 0);
      const secondHalf = processedSalesData.slice(midPoint).reduce((s, d) => s + d.revenue, 0);
      const growthRate = firstHalf > 0 ? ((secondHalf - firstHalf) / firstHalf) * 100 : 0;

      // Find peak hour
      const peakHourEntry = Object.entries(hourlyStats).reduce((max, curr) => 
        curr[1].orders > (max[1]?.orders || 0) ? curr : max
      , ['0', { orders: 0, revenue: 0 }]);

      setStats({
        totalRevenue,
        totalOrders,
        avgOrderValue,
        growthRate,
        topCategory: processedCategoryData[0]?.name || 'N/A',
        peakHour: `${peakHourEntry[0]}:00`,
        conversionRate: 85, // Mock value
        returningCustomers: 42 // Mock value
      });

      // Process waiter data from real orders
      const waiterStats: Record<string, { orders: number; revenue: number; itemsSold: number }> = {};
      orders.forEach(order => {
        if (!order.waiter_id) return;
        if (!waiterStats[order.waiter_id]) {
          waiterStats[order.waiter_id] = { orders: 0, revenue: 0, itemsSold: 0 };
        }
        waiterStats[order.waiter_id].orders += 1;
        waiterStats[order.waiter_id].revenue += Number(order.total) || 0;
        
        // Count items for this order
        const orderItemsForOrder = orderItems.filter((item: any) => item.order_id === order.id);
        waiterStats[order.waiter_id].itemsSold += orderItemsForOrder.reduce((sum: number, item: any) => sum + (item.quantity || 0), 0);
      });

      const processedWaiterData = Object.entries(waiterStats)
        .map(([id, data]) => ({
          id,
          name: waiterMap.get(id) || 'Unknown Waiter',
          orders: data.orders,
          revenue: data.revenue,
          avgOrderValue: data.orders > 0 ? data.revenue / data.orders : 0,
          itemsSold: data.itemsSold
        }))
        .sort((a, b) => b.revenue - a.revenue);
      setWaiterData(processedWaiterData);

      // Mock table data (would need table_id on orders to calculate properly)
      setTableData([
        { tableNumber: 'T1', orders: 12, revenue: 8500, turnoverTime: 45 },
        { tableNumber: 'T2', orders: 15, revenue: 9200, turnoverTime: 38 },
        { tableNumber: 'T3', orders: 10, revenue: 7800, turnoverTime: 52 },
        { tableNumber: 'T4', orders: 18, revenue: 11500, turnoverTime: 35 },
        { tableNumber: 'T5', orders: 8, revenue: 5200, turnoverTime: 48 }
      ]);

    } catch (error) {
      console.error('Error fetching analytics:', error);
      toast.error('Failed to load reports');
    } finally {
      setLoading(false);
    }
  };

  const exportToCSV = (data: any[], filename: string) => {
    if (data.length === 0) {
      toast.error('No data to export');
      return;
    }
    const headers = Object.keys(data[0]);
    const csvContent = [
      headers.join(','),
      ...data.map(row => headers.map(h => {
        const value = row[h];
        return typeof value === 'string' && value.includes(',') ? `"${value}"` : value;
      }).join(','))
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `${filename}_${format(new Date(), 'yyyy-MM-dd')}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
    toast.success(`${filename} exported successfully`);
  };

  const exportAllReports = () => {
    exportToCSV(itemSalesData, 'item_sales_report');
    setTimeout(() => exportToCSV(categoryData, 'category_sales_report'), 300);
    setTimeout(() => exportToCSV(waiterData.map(({ id, ...rest }) => rest), 'waiter_sales_report'), 600);
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
          <h2 className="text-2xl font-bold text-foreground">Detailed Reports & Analytics</h2>
          <p className="text-muted-foreground">Comprehensive business insights and performance metrics</p>
        </div>
        <div className="flex gap-2">
          <Select value={dateRange} onValueChange={(v: any) => setDateRange(v)}>
            <SelectTrigger className="w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="today">Today</SelectItem>
              <SelectItem value="week">This Week</SelectItem>
              <SelectItem value="month">This Month</SelectItem>
              <SelectItem value="quarter">This Quarter</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" onClick={exportAllReports}>
            <Download className="w-4 h-4 mr-2" />
            Export All
          </Button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-4">
        <Card className="col-span-2 border-none shadow-md">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Total Revenue</p>
                <p className="text-2xl font-bold">₹{stats.totalRevenue.toLocaleString()}</p>
                <div className={cn(
                  "flex items-center text-sm mt-1",
                  stats.growthRate >= 0 ? "text-emerald-600" : "text-destructive"
                )}>
                  {stats.growthRate >= 0 ? <ArrowUp className="w-3 h-3 mr-1" /> : <ArrowDown className="w-3 h-3 mr-1" />}
                  {Math.abs(stats.growthRate).toFixed(1)}% vs prev
                </div>
              </div>
              <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center">
                <DollarSign className="w-6 h-6 text-primary" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="col-span-2 border-none shadow-md">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Total Orders</p>
                <p className="text-2xl font-bold">{stats.totalOrders}</p>
                <p className="text-sm text-muted-foreground mt-1">Avg: ₹{stats.avgOrderValue.toFixed(0)}</p>
              </div>
              <div className="w-12 h-12 rounded-xl bg-emerald-500/10 flex items-center justify-center">
                <ShoppingBag className="w-6 h-6 text-emerald-500" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-none shadow-md">
          <CardContent className="pt-6">
            <p className="text-xs text-muted-foreground">Peak Hour</p>
            <p className="text-xl font-bold">{stats.peakHour}</p>
          </CardContent>
        </Card>

        <Card className="border-none shadow-md">
          <CardContent className="pt-6">
            <p className="text-xs text-muted-foreground">Top Category</p>
            <p className="text-xl font-bold truncate">{stats.topCategory}</p>
          </CardContent>
        </Card>

        <Card className="border-none shadow-md">
          <CardContent className="pt-6">
            <p className="text-xs text-muted-foreground">Conversion</p>
            <p className="text-xl font-bold">{stats.conversionRate}%</p>
          </CardContent>
        </Card>

        <Card className="border-none shadow-md">
          <CardContent className="pt-6">
            <p className="text-xs text-muted-foreground">Returning</p>
            <p className="text-xl font-bold">{stats.returningCustomers}%</p>
          </CardContent>
        </Card>
      </div>

      {/* Tabs for different report sections */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full grid-cols-5">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="sales">Sales</TabsTrigger>
          <TabsTrigger value="categories">Categories</TabsTrigger>
          <TabsTrigger value="payments">Payments</TabsTrigger>
          <TabsTrigger value="performance">Performance</TabsTrigger>
        </TabsList>

        {/* Overview Tab */}
        <TabsContent value="overview" className="space-y-6 mt-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Revenue Trend */}
            <Card className="border-none shadow-md">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <TrendingUp className="w-5 h-5" />
                  Revenue Trend
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-[300px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={salesData}>
                      <defs>
                        <linearGradient id="revenueGradient" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.3}/>
                          <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0}/>
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                      <XAxis dataKey="date" className="text-xs" />
                      <YAxis yAxisId="left" className="text-xs" />
                      <YAxis yAxisId="right" orientation="right" className="text-xs" />
                      <Tooltip 
                        contentStyle={{ 
                          backgroundColor: 'hsl(var(--card))', 
                          border: '1px solid hsl(var(--border))',
                          borderRadius: '8px'
                        }}
                      />
                      <Legend />
                      <Area 
                        yAxisId="left"
                        type="monotone" 
                        dataKey="revenue" 
                        stroke="hsl(var(--primary))" 
                        fill="url(#revenueGradient)" 
                        strokeWidth={2}
                        name="Revenue (₹)"
                      />
                      <Line 
                        yAxisId="right"
                        type="monotone" 
                        dataKey="orders" 
                        stroke="hsl(var(--chart-2))" 
                        strokeWidth={2}
                        dot={{ fill: 'hsl(var(--chart-2))' }}
                        name="Orders"
                      />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>

            {/* Hourly Distribution */}
            <Card className="border-none shadow-md">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Clock className="w-5 h-5" />
                  Hourly Distribution
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-[300px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={hourlyData}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                      <XAxis dataKey="hour" className="text-xs" />
                      <YAxis className="text-xs" />
                      <Tooltip 
                        contentStyle={{ 
                          backgroundColor: 'hsl(var(--card))', 
                          border: '1px solid hsl(var(--border))',
                          borderRadius: '8px'
                        }}
                      />
                      <Bar dataKey="orders" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} name="Orders" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>

            {/* Category Distribution */}
            <Card className="border-none shadow-md">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <PieChartIcon className="w-5 h-5" />
                  Category Distribution
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-[300px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={categoryData}
                        cx="50%"
                        cy="50%"
                        innerRadius={60}
                        outerRadius={100}
                        dataKey="revenue"
                        nameKey="name"
                        label={({ name, percent }) => `${name} (${(percent * 100).toFixed(0)}%)`}
                      >
                        {categoryData.map((_, index) => (
                          <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip 
                        contentStyle={{ 
                          backgroundColor: 'hsl(var(--card))', 
                          border: '1px solid hsl(var(--border))',
                          borderRadius: '8px'
                        }}
                        formatter={(value: number) => [`₹${value.toLocaleString()}`, 'Revenue']}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>

            {/* Weekday Performance */}
            <Card className="border-none shadow-md">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Calendar className="w-5 h-5" />
                  Weekday Performance
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-[300px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <RadarChart data={weekdayData}>
                      <PolarGrid />
                      <PolarAngleAxis dataKey="day" className="text-xs" />
                      <PolarRadiusAxis className="text-xs" />
                      <Radar 
                        name="Revenue" 
                        dataKey="revenue" 
                        stroke="hsl(var(--primary))" 
                        fill="hsl(var(--primary))" 
                        fillOpacity={0.3} 
                      />
                      <Tooltip 
                        contentStyle={{ 
                          backgroundColor: 'hsl(var(--card))', 
                          border: '1px solid hsl(var(--border))',
                          borderRadius: '8px'
                        }}
                        formatter={(value: number) => [`₹${value.toLocaleString()}`, 'Revenue']}
                      />
                    </RadarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Sales Tab */}
        <TabsContent value="sales" className="space-y-6 mt-6">
          <Card className="border-none shadow-md">
            <CardHeader>
              <CardTitle>Daily Sales Breakdown</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead className="text-right">Orders</TableHead>
                    <TableHead className="text-right">Revenue</TableHead>
                    <TableHead className="text-right">Avg Order</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {salesData.slice().reverse().map((row, i) => (
                    <TableRow key={i}>
                      <TableCell className="font-medium">{row.date}</TableCell>
                      <TableCell className="text-right">{row.orders}</TableCell>
                      <TableCell className="text-right">₹{row.revenue.toLocaleString()}</TableCell>
                      <TableCell className="text-right">₹{row.avgOrderValue.toFixed(0)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Categories Tab */}
        <TabsContent value="categories" className="space-y-6 mt-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card className="border-none shadow-md">
              <CardHeader>
                <CardTitle>Category Performance</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-[400px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={categoryData} layout="vertical">
                      <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                      <XAxis type="number" className="text-xs" />
                      <YAxis dataKey="name" type="category" className="text-xs" width={100} />
                      <Tooltip 
                        contentStyle={{ 
                          backgroundColor: 'hsl(var(--card))', 
                          border: '1px solid hsl(var(--border))',
                          borderRadius: '8px'
                        }}
                        formatter={(value: number) => [`₹${value.toLocaleString()}`, 'Revenue']}
                      />
                      <Bar dataKey="revenue" fill="hsl(var(--primary))" radius={[0, 4, 4, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>

            <Card className="border-none shadow-md">
              <CardHeader>
                <CardTitle>Category Details</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {categoryData.map((cat, i) => (
                    <div key={cat.name} className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
                      <div className="flex items-center gap-3">
                        <div 
                          className="w-3 h-3 rounded-full"
                          style={{ backgroundColor: COLORS[i % COLORS.length] }}
                        />
                        <div>
                          <p className="font-medium">{cat.name}</p>
                          <p className="text-sm text-muted-foreground">{cat.items} items sold</p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="font-bold">₹{cat.revenue.toLocaleString()}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Payments Tab */}
        <TabsContent value="payments" className="space-y-6 mt-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card className="border-none shadow-md">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <CreditCard className="w-5 h-5" />
                  Payment Methods
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-[300px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={paymentData}
                        cx="50%"
                        cy="50%"
                        innerRadius={60}
                        outerRadius={100}
                        dataKey="amount"
                        nameKey="method"
                        label={({ method, percent }) => `${method} (${(percent * 100).toFixed(0)}%)`}
                      >
                        {paymentData.map((_, index) => (
                          <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip 
                        contentStyle={{ 
                          backgroundColor: 'hsl(var(--card))', 
                          border: '1px solid hsl(var(--border))',
                          borderRadius: '8px'
                        }}
                        formatter={(value: number) => [`₹${value.toLocaleString()}`, 'Amount']}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>

            <Card className="border-none shadow-md">
              <CardHeader>
                <CardTitle>Payment Breakdown</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {paymentData.map((payment, i) => (
                    <div key={payment.method} className="flex items-center justify-between p-4 rounded-lg border">
                      <div className="flex items-center gap-3">
                        <div 
                          className="w-10 h-10 rounded-lg flex items-center justify-center"
                          style={{ backgroundColor: COLORS[i % COLORS.length] + '20' }}
                        >
                          <CreditCard className="w-5 h-5" style={{ color: COLORS[i % COLORS.length] }} />
                        </div>
                        <div>
                          <p className="font-medium">{payment.method}</p>
                          <p className="text-sm text-muted-foreground">{payment.count} transactions</p>
                        </div>
                      </div>
                      <p className="text-xl font-bold">₹{payment.amount.toLocaleString()}</p>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Performance Tab */}
        <TabsContent value="performance" className="space-y-6 mt-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Waiter Performance */}
            <Card className="border-none shadow-md">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Users className="w-5 h-5" />
                  Waiter Performance
                </CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Waiter</TableHead>
                      <TableHead className="text-right">Orders</TableHead>
                      <TableHead className="text-right">Revenue</TableHead>
                      <TableHead className="text-right">Avg</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {waiterData.map((waiter, i) => (
                      <TableRow key={i}>
                        <TableCell className="font-medium">{waiter.name}</TableCell>
                        <TableCell className="text-right">{waiter.orders}</TableCell>
                        <TableCell className="text-right">₹{waiter.revenue.toLocaleString()}</TableCell>
                        <TableCell className="text-right">₹{waiter.avgOrderValue}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            {/* Table Performance */}
            <Card className="border-none shadow-md">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Layers className="w-5 h-5" />
                  Table Performance
                </CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Table</TableHead>
                      <TableHead className="text-right">Orders</TableHead>
                      <TableHead className="text-right">Revenue</TableHead>
                      <TableHead className="text-right">Turnover</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {tableData.map((table, i) => (
                      <TableRow key={i}>
                        <TableCell className="font-medium">{table.tableNumber}</TableCell>
                        <TableCell className="text-right">{table.orders}</TableCell>
                        <TableCell className="text-right">₹{table.revenue.toLocaleString()}</TableCell>
                        <TableCell className="text-right">{table.turnoverTime}m</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
