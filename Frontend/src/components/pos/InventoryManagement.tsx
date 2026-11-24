'use client';

import { useState, useEffect } from 'react';
import { 
  Package, 
  Plus, 
  AlertTriangle, 
  TrendingDown, 
  TrendingUp,
  Edit2,
  Trash2,
  Loader2,
  History,
  Search
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { apiClient, errorMessage } from '@/lib/api-client';
import { useSocketEvents } from '@/hooks/useRealtime';
import { socketClient } from '@/lib/socket-client';
import { toast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';

interface InventoryItem {
  id: string;
  branch_id: string;
  name: string;
  category: string;
  unit: string;
  current_stock: number;
  min_stock_level: number;
  max_stock_level: number | null;
  cost_per_unit: number;
  last_restocked_at: string | null;
  created_at: string;
}

interface InventoryTransaction {
  id: string;
  inventory_id: string;
  transaction_type: string;
  quantity: number;
  notes: string | null;
  created_at: string;
}

const categories = ['Vegetables', 'Meat', 'Dairy', 'Spices', 'Beverages', 'Grains', 'Oil', 'General'];
const units = ['kg', 'g', 'L', 'mL', 'pcs', 'boxes', 'packets'];

export function InventoryManagement() {
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [isStockDialogOpen, setIsStockDialogOpen] = useState(false);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [selectedItem, setSelectedItem] = useState<InventoryItem | null>(null);
  const [transactions, setTransactions] = useState<InventoryTransaction[]>([]);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Form state
  const [formData, setFormData] = useState({
    name: '',
    category: 'General',
    unit: 'kg',
    current_stock: 0,
    min_stock_level: 10,
    max_stock_level: 100,
    cost_per_unit: 0
  });

  const [stockUpdate, setStockUpdate] = useState({
    type: 'purchase' as 'purchase' | 'usage' | 'adjustment' | 'wastage',
    quantity: 0,
    notes: ''
  });

  useEffect(() => {
    fetchInventory();
  }, []);

  // stock changes made elsewhere (other terminals, automatic recipe deduction) refresh the table
  useSocketEvents(['inventory:updated'], () => fetchInventory());

  const fetchInventory = async () => {
    try {
      const data = await apiClient.snake.get<InventoryItem[]>('/inventory');
      setInventory(data || []);
    } catch (error) {
      console.error('Error fetching inventory:', error);
      toast({
        title: "Error",
        description: errorMessage(error, "Failed to load inventory"),
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const fetchTransactions = async (inventoryId: string) => {
    try {
      const data = await apiClient.snake.get<InventoryTransaction[]>(`/inventory/${inventoryId}/transactions`, { limit: 20 });
      setTransactions(data || []);
    } catch (error) {
      console.error('Error fetching transactions:', error);
    }
  };

  const handleAddItem = async () => {
    setIsSubmitting(true);
    try {
      // branch is resolved server-side from the signed-in user's role
      await apiClient.snake.post('/inventory', formData);

      toast({
        title: "Item added",
        description: `${formData.name} has been added to inventory.`,
      });

      setIsAddDialogOpen(false);
      setFormData({
        name: '',
        category: 'General',
        unit: 'kg',
        current_stock: 0,
        min_stock_level: 10,
        max_stock_level: 100,
        cost_per_unit: 0
      });
      fetchInventory();
    } catch (error) {
      console.error('Error adding item:', error);
      toast({
        title: "Error",
        description: errorMessage(error, "Failed to add item"),
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleUpdateStock = async () => {
    if (!selectedItem) return;

    setIsSubmitting(true);
    try {
      // the server applies the change atomically, validates stock and records the transaction
      await apiClient.snake.post(`/inventory/${selectedItem.id}/stock`, {
        type: stockUpdate.type,
        quantity: stockUpdate.quantity,
        notes: stockUpdate.notes || undefined,
      });

      toast({
        title: "Stock updated",
        description: `${selectedItem.name} stock has been updated.`,
      });

      setIsStockDialogOpen(false);
      setStockUpdate({ type: 'purchase', quantity: 0, notes: '' });
      fetchInventory();
    } catch (error) {
      console.error('Error updating stock:', error);
      toast({
        title: "Error",
        description: errorMessage(error, "Failed to update stock"),
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteItem = async (id: string) => {
    try {
      await apiClient.snake.delete(`/inventory/${id}`);

      toast({
        title: "Item deleted",
        description: "Inventory item has been removed.",
      });
      fetchInventory();
    } catch (error) {
      console.error('Error deleting item:', error);
      toast({
        title: "Error",
        description: errorMessage(error, "Failed to delete item"),
        variant: "destructive",
      });
    } finally {
      setDeleteConfirmId(null);
    }
  };

  const getStockStatus = (item: InventoryItem) => {
    if (item.current_stock <= 0) return { status: 'out', label: 'Out of Stock', color: 'bg-destructive/10 text-destructive' };
    if (item.current_stock <= item.min_stock_level) return { status: 'low', label: 'Low Stock', color: 'bg-amber-500/10 text-amber-600' };
    if (item.max_stock_level && item.current_stock >= item.max_stock_level) return { status: 'excess', label: 'Excess', color: 'bg-blue-500/10 text-blue-600' };
    return { status: 'ok', label: 'In Stock', color: 'bg-emerald-500/10 text-emerald-600' };
  };

  const lowStockItems = inventory.filter(item => item.current_stock <= item.min_stock_level);
  const filteredInventory = inventory.filter(item => {
    const matchesSearch = item.name.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesCategory = selectedCategory === 'all' || item.category === selectedCategory;
    return matchesSearch && matchesCategory;
  });

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
          <h2 className="text-2xl font-bold text-foreground">Inventory Management</h2>
          <p className="text-muted-foreground">Track ingredient stock levels</p>
        </div>
        <Button onClick={() => setIsAddDialogOpen(true)}>
          <Plus className="w-4 h-4 mr-2" />
          Add Item
        </Button>
      </div>

      {/* Low Stock Alert */}
      {lowStockItems.length > 0 && (
        <Card className="border-amber-500/30 bg-amber-500/5">
          <CardContent className="pt-6">
            <div className="flex items-start gap-4">
              <div className="w-10 h-10 rounded-full bg-amber-500/20 flex items-center justify-center">
                <AlertTriangle className="w-5 h-5 text-amber-600" />
              </div>
              <div className="flex-1">
                <h3 className="font-semibold text-amber-600">Low Stock Alert</h3>
                <p className="text-sm text-muted-foreground mb-2">
                  {lowStockItems.length} item(s) need restocking
                </p>
                <div className="flex flex-wrap gap-2">
                  {lowStockItems.slice(0, 5).map(item => (
                    <Badge key={item.id} variant="outline" className="bg-amber-500/10 text-amber-600 border-amber-500/30">
                      {item.name}: {item.current_stock} {item.unit}
                    </Badge>
                  ))}
                  {lowStockItems.length > 5 && (
                    <Badge variant="outline">+{lowStockItems.length - 5} more</Badge>
                  )}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="border-none shadow-sm">
          <CardContent className="pt-4">
            <div className="flex items-center gap-2">
              <Package className="w-4 h-4 text-primary" />
              <span className="text-sm text-muted-foreground">Total Items</span>
            </div>
            <p className="text-2xl font-bold mt-1">{inventory.length}</p>
          </CardContent>
        </Card>
        <Card className="border-none shadow-sm">
          <CardContent className="pt-4">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-500" />
              <span className="text-sm text-muted-foreground">Low Stock</span>
            </div>
            <p className="text-2xl font-bold mt-1">{lowStockItems.length}</p>
          </CardContent>
        </Card>
        <Card className="border-none shadow-sm">
          <CardContent className="pt-4">
            <div className="flex items-center gap-2">
              <TrendingDown className="w-4 h-4 text-destructive" />
              <span className="text-sm text-muted-foreground">Out of Stock</span>
            </div>
            <p className="text-2xl font-bold mt-1">
              {inventory.filter(i => i.current_stock <= 0).length}
            </p>
          </CardContent>
        </Card>
        <Card className="border-none shadow-sm">
          <CardContent className="pt-4">
            <div className="flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-emerald-500" />
              <span className="text-sm text-muted-foreground">Stock Value</span>
            </div>
            <p className="text-2xl font-bold mt-1">
              ₹{inventory.reduce((sum, i) => sum + (i.current_stock * i.cost_per_unit), 0).toLocaleString()}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <div className="flex gap-4">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search inventory..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10"
          />
        </div>
        <Select value={selectedCategory} onValueChange={setSelectedCategory}>
          <SelectTrigger className="w-48">
            <SelectValue placeholder="Category" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Categories</SelectItem>
            {categories.map(cat => (
              <SelectItem key={cat} value={cat}>{cat}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Inventory Table */}
      <Card className="border-none shadow-md">
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Item Name</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Current Stock</TableHead>
                <TableHead>Min Level</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Cost/Unit</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredInventory.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                    No inventory items found
                  </TableCell>
                </TableRow>
              ) : (
                filteredInventory.map((item) => {
                  const stockStatus = getStockStatus(item);
                  return (
                    <TableRow key={item.id}>
                      <TableCell className="font-medium">{item.name}</TableCell>
                      <TableCell>
                        <Badge variant="outline">{item.category}</Badge>
                      </TableCell>
                      <TableCell>
                        <span className={cn(
                          "font-medium",
                          stockStatus.status === 'low' && "text-amber-600",
                          stockStatus.status === 'out' && "text-destructive"
                        )}>
                          {item.current_stock} {item.unit}
                        </span>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {item.min_stock_level} {item.unit}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={stockStatus.color}>
                          {stockStatus.label}
                        </Badge>
                      </TableCell>
                      <TableCell>₹{item.cost_per_unit}</TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => {
                              setSelectedItem(item);
                              setStockUpdate({ type: 'purchase', quantity: 0, notes: '' });
                              setIsStockDialogOpen(true);
                            }}
                            title="Update Stock"
                          >
                            <Package className="w-4 h-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => {
                              setSelectedItem(item);
                              fetchTransactions(item.id);
                              setIsHistoryOpen(true);
                            }}
                            title="View History"
                          >
                            <History className="w-4 h-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="text-destructive hover:text-destructive"
                            onClick={() => setDeleteConfirmId(item.id)}
                            title="Delete"
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Add Item Dialog */}
      <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add Inventory Item</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Item Name</Label>
              <Input
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder="e.g., Tomatoes"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Category</Label>
                <Select value={formData.category} onValueChange={(v) => setFormData({ ...formData, category: v })}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {categories.map(cat => (
                      <SelectItem key={cat} value={cat}>{cat}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Unit</Label>
                <Select value={formData.unit} onValueChange={(v) => setFormData({ ...formData, unit: v })}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {units.map(unit => (
                      <SelectItem key={unit} value={unit}>{unit}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Initial Stock</Label>
                <Input
                  type="number"
                  value={formData.current_stock}
                  onChange={(e) => setFormData({ ...formData, current_stock: Number(e.target.value) })}
                />
              </div>
              <div className="space-y-2">
                <Label>Cost per Unit (₹)</Label>
                <Input
                  type="number"
                  value={formData.cost_per_unit}
                  onChange={(e) => setFormData({ ...formData, cost_per_unit: Number(e.target.value) })}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Min Stock Level</Label>
                <Input
                  type="number"
                  value={formData.min_stock_level}
                  onChange={(e) => setFormData({ ...formData, min_stock_level: Number(e.target.value) })}
                />
              </div>
              <div className="space-y-2">
                <Label>Max Stock Level</Label>
                <Input
                  type="number"
                  value={formData.max_stock_level}
                  onChange={(e) => setFormData({ ...formData, max_stock_level: Number(e.target.value) })}
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsAddDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleAddItem} disabled={isSubmitting || !formData.name}>
              {isSubmitting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
              Add Item
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Update Stock Dialog */}
      <Dialog open={isStockDialogOpen} onOpenChange={setIsStockDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Update Stock: {selectedItem?.name}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="p-4 rounded-lg bg-muted/50">
              <p className="text-sm text-muted-foreground">Current Stock</p>
              <p className="text-2xl font-bold">{selectedItem?.current_stock} {selectedItem?.unit}</p>
            </div>
            <div className="space-y-2">
              <Label>Transaction Type</Label>
              <Select value={stockUpdate.type} onValueChange={(v: any) => setStockUpdate({ ...stockUpdate, type: v })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="purchase">Purchase (Add Stock)</SelectItem>
                  <SelectItem value="usage">Usage (Deduct Stock)</SelectItem>
                  <SelectItem value="adjustment">Adjustment</SelectItem>
                  <SelectItem value="wastage">Wastage</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Quantity</Label>
              <Input
                type="number"
                value={stockUpdate.quantity}
                onChange={(e) => setStockUpdate({ ...stockUpdate, quantity: Number(e.target.value) })}
              />
            </div>
            <div className="space-y-2">
              <Label>Notes (Optional)</Label>
              <Input
                value={stockUpdate.notes}
                onChange={(e) => setStockUpdate({ ...stockUpdate, notes: e.target.value })}
                placeholder="e.g., Weekly restock"
              />
            </div>
            <div className="p-3 rounded-lg bg-primary/10">
              <p className="text-sm">New Stock Level</p>
              <p className="text-xl font-bold text-primary">
                {selectedItem && (
                  stockUpdate.type === 'purchase' || stockUpdate.type === 'adjustment'
                    ? selectedItem.current_stock + stockUpdate.quantity
                    : selectedItem.current_stock - stockUpdate.quantity
                )} {selectedItem?.unit}
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsStockDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleUpdateStock} disabled={isSubmitting || stockUpdate.quantity <= 0}>
              {isSubmitting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
              Update Stock
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Transaction History Dialog */}
      <Dialog open={isHistoryOpen} onOpenChange={setIsHistoryOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Stock History: {selectedItem?.name}</DialogTitle>
          </DialogHeader>
          <div className="max-h-96 overflow-y-auto">
            {transactions.length === 0 ? (
              <p className="text-center text-muted-foreground py-8">No transactions recorded</p>
            ) : (
              <div className="space-y-3">
                {transactions.map(tx => (
                  <div key={tx.id} className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
                    <div>
                      <Badge variant="outline" className={cn(
                        tx.transaction_type === 'purchase' && "bg-emerald-500/10 text-emerald-600",
                        tx.transaction_type === 'usage' && "bg-amber-500/10 text-amber-600",
                        tx.transaction_type === 'wastage' && "bg-destructive/10 text-destructive",
                        tx.transaction_type === 'adjustment' && "bg-blue-500/10 text-blue-600",
                      )}>
                        {tx.transaction_type}
                      </Badge>
                      <p className="text-sm text-muted-foreground mt-1">
                        {format(new Date(tx.created_at), 'MMM dd, yyyy HH:mm')}
                      </p>
                      {tx.notes && <p className="text-sm mt-1">{tx.notes}</p>}
                    </div>
                    <span className={cn(
                      "text-lg font-bold",
                      (tx.transaction_type === 'purchase' || tx.transaction_type === 'adjustment') ? "text-emerald-600" : "text-destructive"
                    )}>
                      {(tx.transaction_type === 'purchase' || tx.transaction_type === 'adjustment') ? '+' : '-'}{tx.quantity}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog open={!!deleteConfirmId} onOpenChange={() => setDeleteConfirmId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Inventory Item?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete this item and all its transaction history.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deleteConfirmId && handleDeleteItem(deleteConfirmId)}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}