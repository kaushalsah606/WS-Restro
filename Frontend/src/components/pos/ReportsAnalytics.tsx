'use client';

import { useState, useEffect } from 'react';
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
  ArrowDown
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
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
  Line
} from 'recharts';
import { apiClient, errorMessage } from '@/lib/api-client';
import { format, subDays, startOfDay, endOfDay, parseISO } from 'date-fns';

interface SalesData {
  date: string;
  revenue: number;
  orders: number;
}

interface PopularItem {
  name: string;
  quantity: number;
  revenue: number;
}

interface HourlyData {
  hour: string;
  orders: number;
  revenue: number;
}

const COLORS = ['hsl(var(--primary))', 'hsl(var(--chart-2))', 'hsl(var(--chart-3))', 'hsl(var(--chart-4))', 'hsl(var(--chart-5))'];

export function ReportsAnalytics() {
  const [loading, setLoading] = useState(true);
  const [dateRange, setDateRange] = useState<'today' | 'week' | 'month'>('week');
  const [salesData, setSalesData] = useState<SalesData[]>([]);
  const [popularItems, setPopularItems] = useState<PopularItem[]>([]);
  const [hourlyData, setHourlyData] = useState<HourlyData[]>([]);
  const [stats, setStats] = useState({
    totalRevenue: 0,
    totalOrders: 0,
    avgOrderValue: 0,
    growthRate: 0
  });

  useEffect(() => {
    fetchAnalytics();
  }, [dateRange]);

  const fetchAnalytics = async () => {
    setLoading(true);
    try {
      const days = dateRange === 'today' ? 1 : dateRange === 'week' ? 7 : 30;
      const startDate = subDays(new Date(), days);

      // Completed bills and order lines for the period, straight from the API
      const [bills, orderItems] = await Promise.all([
        apiClient.snake.get<any[]>('/billing', { status: 'completed', start_date: startDate.toISOString(), limit: 1000 }),
        apiClient.snake.get<any[]>('/orders/items', { start_date: startDate.toISOString() }),
      ]);

      // Process sales data by date
      const salesByDate: Record<string, { revenue: number; orders: number }> = {};
      for (let i = 0; i < days; i++) {
        const date = format(subDays(new Date(), days - 1 - i), 'yyyy-MM-dd');
        salesByDate[date] = { revenue: 0, orders: 0 };
      }

      (bills || []).forEach(bill => {
        const date = format(parseISO(bill.generated_at), 'yyyy-MM-dd');
        if (salesByDate[date]) {
          salesByDate[date].revenue += Number(bill.total) || 0;
          salesByDate[date].orders += 1;
        }
      });

      const processedSalesData = Object.entries(salesByDate).map(([date, data]) => ({
        date: format(parseISO(date), 'MMM dd'),
        revenue: data.revenue,
        orders: data.orders
      }));

      setSalesData(processedSalesData);

      // Process popular items
      const itemCounts: Record<string, { quantity: number; revenue: number }> = {};
      (orderItems || []).forEach(item => {
        const name = Array.isArray(item.menu_item) ? item.menu_item[0]?.name : (item.menu_item as any)?.name;
        if (name) {
          if (!itemCounts[name]) {
            itemCounts[name] = { quantity: 0, revenue: 0 };
          }
          itemCounts[name].quantity += item.quantity || 0;
          itemCounts[name].revenue += Number(item.total) || 0;
        }
      });

      const sortedItems = Object.entries(itemCounts)
        .map(([name, data]) => ({ name, ...data }))
        .sort((a, b) => b.quantity - a.quantity)
        .slice(0, 5);

      setPopularItems(sortedItems);

      // Generate hourly distribution (mock data based on typical patterns)
      const hourlyDistribution: HourlyData[] = [];
      for (let h = 9; h <= 22; h++) {
        const hour = `${h}:00`;
        const factor = h >= 12 && h <= 14 ? 1.5 : h >= 19 && h <= 21 ? 2 : 1;
        hourlyDistribution.push({
          hour,
          orders: Math.floor((bills?.length || 0) * factor * 0.1),
          revenue: Math.floor((bills?.reduce((sum, b) => sum + (Number(b.total) || 0), 0) || 0) * factor * 0.08)
        });
      }
      setHourlyData(hourlyDistribution);

      // Calculate stats
      const totalRevenue = (bills || []).reduce((sum, b) => sum + (Number(b.total) || 0), 0);
      const totalOrders = bills?.length || 0;
      const avgOrderValue = totalOrders > 0 ? totalRevenue / totalOrders : 0;
      
      // Calculate growth (compare first half to second half of period)
      const midPoint = Math.floor(processedSalesData.length / 2);
      const firstHalf = processedSalesData.slice(0, midPoint).reduce((s, d) => s + d.revenue, 0);
      const secondHalf = processedSalesData.slice(midPoint).reduce((s, d) => s + d.revenue, 0);
      const growthRate = firstHalf > 0 ? ((secondHalf - firstHalf) / firstHalf) * 100 : 0;

      setStats({ totalRevenue, totalOrders, avgOrderValue, growthRate });
    } catch (error) {
      console.error('Error fetching analytics:', error);
    } finally {
      setLoading(false);
    }
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
          <h2 className="text-2xl font-bold text-foreground">Reports & Analytics</h2>
          <p className="text-muted-foreground">Track sales performance and trends</p>
        </div>
        <div className="flex gap-2">
          <Button 
            variant={dateRange === 'today' ? 'default' : 'outline'} 
            size="sm"
            onClick={() => setDateRange('today')}
          >
            Today
          </Button>
          <Button 
            variant={dateRange === 'week' ? 'default' : 'outline'} 
            size="sm"
            onClick={() => setDateRange('week')}
          >
            This Week
          </Button>
          <Button 
            variant={dateRange === 'month' ? 'default' : 'outline'} 
            size="sm"
            onClick={() => setDateRange('month')}
          >
            This Month
          </Button>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="border-none shadow-md">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Total Revenue</p>
                <p className="text-2xl font-bold">₹{stats.totalRevenue.toLocaleString()}</p>
              </div>
              <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center">
                <DollarSign className="w-6 h-6 text-primary" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-none shadow-md">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Total Orders</p>
                <p className="text-2xl font-bold">{stats.totalOrders}</p>
              </div>
              <div className="w-12 h-12 rounded-xl bg-emerald-500/10 flex items-center justify-center">
                <ShoppingBag className="w-6 h-6 text-emerald-500" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-none shadow-md">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Avg Order Value</p>
                <p className="text-2xl font-bold">₹{stats.avgOrderValue.toFixed(0)}</p>
              </div>
              <div className="w-12 h-12 rounded-xl bg-amber-500/10 flex items-center justify-center">
                <BarChart3 className="w-6 h-6 text-amber-500" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-none shadow-md">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Growth Rate</p>
                <div className="flex items-center gap-2">
                  <p className="text-2xl font-bold">{Math.abs(stats.growthRate).toFixed(1)}%</p>
                  {stats.growthRate >= 0 ? (
                    <ArrowUp className="w-5 h-5 text-emerald-500" />
                  ) : (
                    <ArrowDown className="w-5 h-5 text-destructive" />
                  )}
                </div>
              </div>
              <div className="w-12 h-12 rounded-xl bg-blue-500/10 flex items-center justify-center">
                <TrendingUp className="w-6 h-6 text-blue-500" />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Charts Grid */}
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
                <AreaChart data={salesData}>
                  <defs>
                    <linearGradient id="revenueGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.3}/>
                      <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis dataKey="date" className="text-xs" />
                  <YAxis className="text-xs" />
                  <Tooltip 
                    contentStyle={{ 
                      backgroundColor: 'hsl(var(--card))', 
                      border: '1px solid hsl(var(--border))',
                      borderRadius: '8px'
                    }}
                    formatter={(value: number) => [`₹${value.toLocaleString()}`, 'Revenue']}
                  />
                  <Area 
                    type="monotone" 
                    dataKey="revenue" 
                    stroke="hsl(var(--primary))" 
                    fill="url(#revenueGradient)" 
                    strokeWidth={2}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        {/* Orders by Day */}
        <Card className="border-none shadow-md">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ShoppingBag className="w-5 h-5" />
              Daily Orders
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={salesData}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis dataKey="date" className="text-xs" />
                  <YAxis className="text-xs" />
                  <Tooltip 
                    contentStyle={{ 
                      backgroundColor: 'hsl(var(--card))', 
                      border: '1px solid hsl(var(--border))',
                      borderRadius: '8px'
                    }}
                  />
                  <Bar dataKey="orders" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        {/* Popular Items */}
        <Card className="border-none shadow-md">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <BarChart3 className="w-5 h-5" />
              Top Selling Items
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={popularItems}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={100}
                    fill="#8884d8"
                    dataKey="quantity"
                    nameKey="name"
                    label={({ name, percent }) => `${name} (${(percent * 100).toFixed(0)}%)`}
                  >
                    {popularItems.map((_, index) => (
                      <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip 
                    contentStyle={{ 
                      backgroundColor: 'hsl(var(--card))', 
                      border: '1px solid hsl(var(--border))',
                      borderRadius: '8px'
                    }}
                    formatter={(value: number, name: string) => [value, name]}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        {/* Peak Hours */}
        <Card className="border-none shadow-md">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Clock className="w-5 h-5" />
              Peak Hours
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={hourlyData}>
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
                  <Line 
                    type="monotone" 
                    dataKey="orders" 
                    stroke="hsl(var(--primary))" 
                    strokeWidth={2}
                    dot={{ fill: 'hsl(var(--primary))' }}
                  />
                  <Line 
                    type="monotone" 
                    dataKey="revenue" 
                    stroke="hsl(var(--chart-2))" 
                    strokeWidth={2}
                    dot={{ fill: 'hsl(var(--chart-2))' }}
                  />
                  <Legend />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Top Items Table */}
      <Card className="border-none shadow-md">
        <CardHeader>
          <CardTitle>Top Selling Items Details</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {popularItems.map((item, index) => (
              <div key={item.name} className="flex items-center justify-between p-4 rounded-lg bg-muted/50">
                <div className="flex items-center gap-4">
                  <div className="w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold" 
                       style={{ backgroundColor: COLORS[index % COLORS.length] + '20', color: COLORS[index % COLORS.length] }}>
                    {index + 1}
                  </div>
                  <div>
                    <p className="font-medium">{item.name}</p>
                    <p className="text-sm text-muted-foreground">{item.quantity} orders</p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="font-bold">₹{item.revenue.toLocaleString()}</p>
                  <p className="text-sm text-muted-foreground">Revenue</p>
                </div>
              </div>
            ))}
            {popularItems.length === 0 && (
              <p className="text-center text-muted-foreground py-8">No sales data available</p>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}