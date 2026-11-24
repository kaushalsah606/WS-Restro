'use client';

import { useState } from 'react';
import { Search, Filter, Clock, MoreHorizontal, Eye, Printer, Receipt, Ban } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { usePOSStore } from '@/stores/posStore';
import { cn } from '@/lib/utils';
import type { OrderStatus } from '@/types/pos';

const statusFilters: { id: OrderStatus | 'all'; label: string }[] = [
  { id: 'all', label: 'All Orders' },
  { id: 'pending', label: 'Pending' },
  { id: 'preparing', label: 'Preparing' },
  { id: 'ready', label: 'Ready' },
  { id: 'served', label: 'Served' },
  { id: 'cancelled', label: 'Cancelled' },
];

export function OrdersList() {
  const [statusFilter, setStatusFilter] = useState<OrderStatus | 'all'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  
  const orders = usePOSStore(state => state.orders);
  const tables = usePOSStore(state => state.tables);

  const filteredOrders = orders.filter(order => {
    const matchesStatus = statusFilter === 'all' || order.status === statusFilter;
    const matchesSearch = order.orderNumber.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesStatus && matchesSearch;
  });

  const getTableNumber = (tableId?: string) => {
    if (!tableId) return 'Takeaway';
    const table = tables.find(t => t.id === tableId);
    return table ? `Table ${table.number}` : 'Unknown';
  };

  const formatTime = (date: Date) => {
    return new Date(date).toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-foreground">Orders</h2>
          <p className="text-muted-foreground">Manage and track all orders</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search orders..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10 w-64"
            />
          </div>
          <Button variant="outline" className="gap-2">
            <Filter className="w-4 h-4" />
            Filter
          </Button>
        </div>
      </div>

      {/* Status Filters */}
      <div className="flex items-center gap-2 overflow-x-auto pb-2">
        {statusFilters.map(filter => (
          <Button
            key={filter.id}
            variant={statusFilter === filter.id ? 'default' : 'outline'}
            size="sm"
            onClick={() => setStatusFilter(filter.id)}
            className={cn(
              "shrink-0",
              statusFilter === filter.id && "bg-primary text-primary-foreground"
            )}
          >
            {filter.label}
            {filter.id !== 'all' && (
              <Badge variant="secondary" className="ml-2">
                {orders.filter(o => o.status === filter.id).length}
              </Badge>
            )}
          </Button>
        ))}
      </div>

      {/* Orders Table */}
      <Card className="border-none shadow-md">
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50">
                <TableHead>Order</TableHead>
                <TableHead>Table</TableHead>
                <TableHead>Items</TableHead>
                <TableHead>Total</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Time</TableHead>
                <TableHead className="w-12"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredOrders.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                    No orders found
                  </TableCell>
                </TableRow>
              ) : (
                filteredOrders.map(order => (
                  <TableRow key={order.id} className="hover:bg-muted/30">
                    <TableCell>
                      <div className="font-medium text-foreground">{order.orderNumber}</div>
                      <div className="text-xs text-muted-foreground capitalize">
                        {order.type.replace('_', ' ')}
                      </div>
                    </TableCell>
                    <TableCell>
                      <span className="font-medium">{getTableNumber(order.tableId)}</span>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <span className="font-medium">{order.items.length}</span>
                        <span className="text-muted-foreground">items</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <span className="font-bold">₹{order.total.toFixed(0)}</span>
                    </TableCell>
                    <TableCell>
                      <Badge 
                        variant="outline"
                        className={cn(
                          "capitalize",
                          order.status === 'pending' && "bg-order-pending/10 text-order-pending border-order-pending/30",
                          order.status === 'preparing' && "bg-order-preparing/10 text-order-preparing border-order-preparing/30",
                          order.status === 'ready' && "bg-order-ready/10 text-order-ready border-order-ready/30",
                          order.status === 'served' && "bg-order-served/10 text-order-served border-order-served/30",
                          order.status === 'cancelled' && "bg-destructive/10 text-destructive border-destructive/30",
                        )}
                      >
                        {order.status}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1 text-muted-foreground">
                        <Clock className="w-4 h-4" />
                        {formatTime(order.createdAt)}
                      </div>
                    </TableCell>
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon">
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
                            Print KOT
                          </DropdownMenuItem>
                          <DropdownMenuItem>
                            <Receipt className="w-4 h-4 mr-2" />
                            Generate Bill
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem className="text-destructive">
                            <Ban className="w-4 h-4 mr-2" />
                            Cancel Order
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
