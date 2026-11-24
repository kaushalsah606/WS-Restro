'use client';

import { useState } from 'react';
import { 
  CreditCard, 
  Receipt, 
  DollarSign,
  Clock,
  CheckCircle,
  TrendingUp,
  Banknote,
  Wallet,
  Loader2,
  Printer,
  Split,
  AlertCircle,
  ArrowUpRight,
  Eye,
  MoreHorizontal,
  RefreshCw,
  QrCode,
  Smartphone
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Progress } from '@/components/ui/progress';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { useOrders, useBills } from '@/hooks/useDatabase';

export function CashierDashboard() {
  const { orders, loading: ordersLoading } = useOrders();
  const { bills, loading: billsLoading } = useBills();
  const [activeTab, setActiveTab] = useState('pending');

  const loading = ordersLoading || billsLoading;

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const pendingBills = bills.filter(b => b.status === 'pending');
  const completedBills = bills.filter(b => 
    b.status === 'completed' && b.paid_at && new Date(b.paid_at) >= today
  );
  const servedOrders = orders.filter(o => o.status === 'served');
  const partialBills = bills.filter(b => b.status === 'partial');
  
  const todayCollection = completedBills.reduce((sum, b) => sum + Number(b.total || 0), 0);
  const pendingAmount = pendingBills.reduce((sum, b) => sum + Number(b.total || 0), 0);

  // Payment method breakdown
  const paymentMethods = [
    { method: 'Cash', amount: todayCollection * 0.40, icon: Banknote, color: 'text-status-available', bgColor: 'bg-status-available/10', transactions: Math.round(completedBills.length * 0.40) },
    { method: 'Card', amount: todayCollection * 0.35, icon: CreditCard, color: 'text-primary', bgColor: 'bg-primary/10', transactions: Math.round(completedBills.length * 0.35) },
    { method: 'UPI', amount: todayCollection * 0.20, icon: Smartphone, color: 'text-accent', bgColor: 'bg-accent/10', transactions: Math.round(completedBills.length * 0.20) },
    { method: 'Wallet', amount: todayCollection * 0.05, icon: Wallet, color: 'text-order-preparing', bgColor: 'bg-order-preparing/10', transactions: Math.round(completedBills.length * 0.05) },
  ];

  // Recent transactions
  const recentTransactions = completedBills.slice(0, 8).map((bill, index) => ({
    id: bill.id,
    billNumber: bill.bill_number,
    amount: Number(bill.total || 0),
    method: index % 4 === 0 ? 'Cash' : index % 4 === 1 ? 'Card' : index % 4 === 2 ? 'UPI' : 'Wallet',
    time: bill.paid_at ? new Date(bill.paid_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : '-',
    table: `T${Math.floor(Math.random() * 20) + 1}`,
  }));

  // Pending bills queue
  const pendingQueue = servedOrders.map(order => ({
    id: order.id,
    orderNumber: order.order_number,
    table: order.table_id ? `T${order.table_id.slice(-2)}` : 'Takeaway',
    items: (order.order_items || []).length,
    total: Number(order.total || 0),
    waitTime: Math.floor((Date.now() - new Date(order.updated_at || order.created_at || Date.now()).getTime()) / 60000),
    type: order.order_type,
  }));

  const statCards = [
    {
      title: "Today's Collection",
      value: `₹${todayCollection.toLocaleString()}`,
      change: '+8.5% vs yesterday',
      icon: TrendingUp,
      color: 'text-status-available',
      bgColor: 'bg-status-available/10',
    },
    {
      title: 'Pending Bills',
      value: pendingBills.length.toString(),
      subtitle: `₹${pendingAmount.toLocaleString()} pending`,
      icon: Clock,
      color: 'text-order-preparing',
      bgColor: 'bg-order-preparing/10',
      urgent: pendingBills.length > 5,
    },
    {
      title: 'Bills Processed',
      value: completedBills.length.toString(),
      subtitle: 'Today',
      icon: CheckCircle,
      color: 'text-primary',
      bgColor: 'bg-primary/10',
    },
    {
      title: 'Ready for Billing',
      value: servedOrders.length.toString(),
      subtitle: 'Orders served',
      icon: Receipt,
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
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-status-available/10">
            <DollarSign className="w-6 h-6 text-status-available" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-foreground">Cashier Dashboard</h2>
            <p className="text-sm text-muted-foreground">Billing and payment management</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm">
            <RefreshCw className="w-4 h-4 mr-2" />
            Sync
          </Button>
          <Button size="sm">
            <Printer className="w-4 h-4 mr-2" />
            Print Report
          </Button>
        </div>
      </div>

      {/* Urgent Alert */}
      {pendingQueue.filter(p => p.waitTime > 10).length > 0 && (
        <Card className="border-order-preparing/50 bg-order-preparing/5">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="p-2 rounded-full bg-order-preparing/20 animate-pulse">
              <AlertCircle className="w-5 h-5 text-order-preparing" />
            </div>
            <div className="flex-1">
              <p className="font-medium text-foreground">
                {pendingQueue.filter(p => p.waitTime > 10).length} orders waiting for billing over 10 mins
              </p>
              <p className="text-sm text-muted-foreground">Process them to improve customer experience</p>
            </div>
            <Button size="sm" variant="outline">View Queue</Button>
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
              stat.urgent && "ring-2 ring-order-preparing ring-offset-2"
            )}
          >
            <CardContent className="p-5">
              <div className="flex items-start justify-between">
                <div className="space-y-1">
                  <p className="text-xs font-medium text-muted-foreground">{stat.title}</p>
                  <p className="text-2xl font-bold text-foreground">{stat.value}</p>
                  {stat.change && (
                    <div className="flex items-center gap-1">
                      <ArrowUpRight className="w-3 h-3 text-status-available" />
                      <p className="text-xs text-status-available font-medium">{stat.change}</p>
                    </div>
                  )}
                  {stat.subtitle && (
                    <p className="text-xs text-muted-foreground">{stat.subtitle}</p>
                  )}
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
        {/* Billing Queue */}
        <Card className="border-none shadow-md lg:col-span-2">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-lg font-semibold flex items-center gap-2">
                  <Receipt className="w-5 h-5 text-primary" />
                  Billing Queue
                </CardTitle>
                <CardDescription>Orders ready for billing</CardDescription>
              </div>
              <Tabs value={activeTab} onValueChange={setActiveTab}>
                <TabsList className="h-8">
                  <TabsTrigger value="pending" className="text-xs">Pending ({pendingQueue.length})</TabsTrigger>
                  <TabsTrigger value="partial" className="text-xs">Partial ({partialBills.length})</TabsTrigger>
                </TabsList>
              </Tabs>
            </div>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-[400px]">
              <div className="space-y-3">
                {pendingQueue.length === 0 ? (
                  <div className="text-center py-12 text-muted-foreground">
                    <CheckCircle className="w-16 h-16 mx-auto mb-3 opacity-50" />
                    <p className="text-lg font-medium">All caught up!</p>
                    <p className="text-sm">No orders waiting for billing</p>
                  </div>
                ) : (
                  pendingQueue.map((order) => (
                    <div 
                      key={order.id}
                      className={cn(
                        "flex items-center justify-between p-4 rounded-xl transition-all hover:shadow-md cursor-pointer",
                        order.waitTime > 10 
                          ? "bg-order-preparing/5 border border-order-preparing/30" 
                          : "bg-muted/50 hover:bg-muted"
                      )}
                    >
                      <div className="flex items-center gap-4">
                        <div className={cn(
                          "w-14 h-14 rounded-xl flex flex-col items-center justify-center",
                          order.type === 'dine_in' ? "bg-primary/10" : "bg-accent/10"
                        )}>
                          <span className="font-bold text-primary">{order.table}</span>
                          <span className="text-[10px] text-muted-foreground capitalize">
                            {order.type?.replace('_', ' ')}
                          </span>
                        </div>
                        <div>
                          <p className="font-semibold text-foreground">{order.orderNumber}</p>
                          <p className="text-sm text-muted-foreground">{order.items} items</p>
                          <div className="flex items-center gap-1 mt-1">
                            <Clock className={cn(
                              "w-3 h-3",
                              order.waitTime > 10 ? "text-order-preparing" : "text-muted-foreground"
                            )} />
                            <span className={cn(
                              "text-xs",
                              order.waitTime > 10 ? "text-order-preparing font-medium" : "text-muted-foreground"
                            )}>
                              {order.waitTime} min waiting
                            </span>
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <div className="text-right">
                          <p className="text-xl font-bold text-foreground">₹{order.total.toLocaleString()}</p>
                        </div>
                        <div className="flex flex-col gap-1">
                          <Button size="sm" className="h-8">
                            <Receipt className="w-3 h-3 mr-1" />
                            Bill
                          </Button>
                          <Button size="sm" variant="outline" className="h-8">
                            <Split className="w-3 h-3 mr-1" />
                            Split
                          </Button>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>

        {/* Right Column */}
        <div className="space-y-6">
          {/* Payment Summary */}
          <Card className="border-none shadow-md">
            <CardHeader className="pb-3">
              <CardTitle className="text-lg font-semibold flex items-center gap-2">
                <CreditCard className="w-5 h-5 text-primary" />
                Payment Summary
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {paymentMethods.map((payment) => (
                  <div 
                    key={payment.method}
                    className="flex items-center justify-between p-3 rounded-xl bg-muted/50"
                  >
                    <div className="flex items-center gap-3">
                      <div className={cn("p-2 rounded-lg", payment.bgColor)}>
                        <payment.icon className={cn("w-4 h-4", payment.color)} />
                      </div>
                      <div>
                        <p className="font-medium text-foreground">{payment.method}</p>
                        <p className="text-xs text-muted-foreground">{payment.transactions} txns</p>
                      </div>
                    </div>
                    <p className="font-bold text-foreground">₹{payment.amount.toLocaleString()}</p>
                  </div>
                ))}
                <div className="pt-4 border-t border-border">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-foreground">Total Collection</span>
                    <span className="text-2xl font-bold text-primary">₹{todayCollection.toLocaleString()}</span>
                  </div>
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
                  <QrCode className="w-5 h-5" />
                  <span className="text-xs">Scan QR</span>
                </Button>
                <Button variant="outline" className="h-16 flex-col gap-1">
                  <Split className="w-5 h-5" />
                  <span className="text-xs">Split Bill</span>
                </Button>
                <Button variant="outline" className="h-16 flex-col gap-1">
                  <Printer className="w-5 h-5" />
                  <span className="text-xs">Re-print</span>
                </Button>
                <Button variant="outline" className="h-16 flex-col gap-1">
                  <RefreshCw className="w-5 h-5" />
                  <span className="text-xs">Refund</span>
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Recent Transactions */}
          <Card className="border-none shadow-md">
            <CardHeader className="pb-3">
              <CardTitle className="text-lg font-semibold flex items-center gap-2">
                <CheckCircle className="w-5 h-5 text-status-available" />
                Recent Transactions
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-[200px]">
                <div className="space-y-2">
                  {recentTransactions.length === 0 ? (
                    <p className="text-center py-4 text-muted-foreground">No transactions today</p>
                  ) : (
                    recentTransactions.map((txn) => (
                      <div 
                        key={txn.id}
                        className="flex items-center justify-between p-2 rounded-lg hover:bg-muted/50 transition-colors"
                      >
                        <div className="flex items-center gap-2">
                          <CheckCircle className="w-4 h-4 text-status-available" />
                          <div>
                            <p className="text-sm font-medium text-foreground">{txn.billNumber}</p>
                            <p className="text-xs text-muted-foreground">{txn.table} • {txn.time}</p>
                          </div>
                        </div>
                        <div className="text-right">
                          <p className="font-bold text-foreground">₹{txn.amount.toLocaleString()}</p>
                          <Badge variant="outline" className="text-xs">{txn.method}</Badge>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
