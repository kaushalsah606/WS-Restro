'use client';

import { useState, useEffect } from 'react';
import {
  Printer,
  Plus,
  Edit2,
  Trash2,
  CheckCircle2,
  XCircle,
  Wifi,
  Usb,
  RefreshCw,
  TestTube2,
  Settings2,
  Star,
  Loader2,
  AlertCircle
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
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
import { Checkbox } from '@/components/ui/checkbox';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { apiClient, errorMessage } from '@/lib/api-client';
import { toast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { printQueue } from '@/services/printerService';

interface Printer {
  id: string;
  name: string;
  type: string;
  connection_type: string;
  ip_address: string | null;
  port: number | null;
  is_active: boolean;
  is_default: boolean;
  categories: string[] | null;
  print_for: string[] | null;
  branch_id: string;
  created_at: string;
  updated_at: string;
}

interface Category {
  id: string;
  name: string;
}

const PRINT_PURPOSES = [
  { id: 'kot', label: 'Kitchen Orders (KOT)', description: 'Print kitchen order tickets' },
  { id: 'bill', label: 'Bills & Receipts', description: 'Print customer bills' },
  { id: 'report', label: 'Reports', description: 'Print daily/weekly reports' },
];

const PRINTER_TYPES = [
  { id: 'thermal', label: 'Thermal Printer' },
  { id: 'receipt', label: 'Receipt Printer' },
  { id: 'kitchen', label: 'Kitchen Printer' },
];

const CONNECTION_TYPES = [
  { id: 'usb', label: 'USB', icon: Usb },
  { id: 'network', label: 'Network/LAN', icon: Wifi },
];

export function PrinterManagement() {
  const [printers, setPrinters] = useState<Printer[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const [selectedPrinter, setSelectedPrinter] = useState<Printer | null>(null);
  const [testingPrinter, setTestingPrinter] = useState<string | null>(null);
  
  // Form state
  const [formData, setFormData] = useState({
    name: '',
    type: 'thermal',
    connection_type: 'usb',
    ip_address: '',
    port: 9100,
    is_active: true,
    is_default: false,
    categories: [] as string[],
    print_for: [] as string[],
  });

  // Default branch ID (would come from auth context in real app)
  const branchId = 'b1c2d3e4-f5a6-7890-bcde-f12345678901';

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      const [printersData, categoriesData] = await Promise.all([
        apiClient.snake.get<Printer[]>('/printers'),
        apiClient.snake.get<Category[]>('/menu/categories'),
      ]);
      setPrinters(printersData || []);
      setCategories(categoriesData || []);
    } catch (error) {
      console.error('Error fetching data:', error);
      toast({
        title: "Error",
        description: errorMessage(error, "Failed to load printer data"),
        variant: "destructive"
      });
    } finally {
      setLoading(false);
    }
  };

  const resetForm = () => {
    setFormData({
      name: '',
      type: 'thermal',
      connection_type: 'usb',
      ip_address: '',
      port: 9100,
      is_active: true,
      is_default: false,
      categories: [],
      print_for: [],
    });
    setSelectedPrinter(null);
  };

  const openAddDialog = () => {
    resetForm();
    setIsDialogOpen(true);
  };

  const openEditDialog = (printer: Printer) => {
    setSelectedPrinter(printer);
    setFormData({
      name: printer.name,
      type: printer.type,
      connection_type: printer.connection_type,
      ip_address: printer.ip_address || '',
      port: printer.port || 9100,
      is_active: printer.is_active,
      is_default: printer.is_default,
      categories: printer.categories || [],
      print_for: printer.print_for || [],
    });
    setIsDialogOpen(true);
  };

  const handleSave = async () => {
    if (!formData.name.trim()) {
      toast({
        title: "Validation Error",
        description: "Printer name is required",
        variant: "destructive"
      });
      return;
    }

    if (formData.connection_type === 'network' && !formData.ip_address.trim()) {
      toast({
        title: "Validation Error",
        description: "IP address is required for network printers",
        variant: "destructive"
      });
      return;
    }

    try {
      const printerData = {
        name: formData.name,
        type: formData.type,
        connection_type: formData.connection_type,
        ip_address: formData.connection_type === 'network' ? formData.ip_address : null,
        port: formData.connection_type === 'network' ? formData.port : null,
        is_active: formData.is_active,
        is_default: formData.is_default,
        categories: formData.categories,
        print_for: formData.print_for,
      };

      // the server keeps exactly one default printer per branch
      if (selectedPrinter) {
        await apiClient.snake.put(`/printers/${selectedPrinter.id}`, printerData);
        toast({ title: "Printer updated successfully" });
      } else {
        await apiClient.snake.post('/printers', printerData);
        toast({ title: "Printer added successfully" });
      }

      setIsDialogOpen(false);
      resetForm();
      fetchData();
    } catch (error) {
      console.error('Error saving printer:', error);
      toast({
        title: "Error",
        description: errorMessage(error, "Failed to save printer"),
        variant: "destructive"
      });
    }
  };

  const handleDelete = async () => {
    if (!selectedPrinter) return;

    try {
      await apiClient.snake.delete(`/printers/${selectedPrinter.id}`);

      toast({ title: "Printer deleted successfully" });
      setIsDeleteOpen(false);
      setSelectedPrinter(null);
      fetchData();
    } catch (error) {
      console.error('Error deleting printer:', error);
      toast({
        title: "Error",
        description: errorMessage(error, "Failed to delete printer"),
        variant: "destructive"
      });
    }
  };

  const handleTestPrint = async (printer: Printer) => {
    setTestingPrinter(printer.id);
    
    try {
      // queued on the server (BullMQ): network printers get ESC/POS over TCP:9100,
      // USB printers are handed to the terminal over Socket.IO ("print:job")
      const job = await apiClient.snake.post<{ id: string }>(`/printers/${printer.id}/test`);

      toast({
        title: "Test print queued",
        description: `Job ${job.id.slice(0, 8)} sent to ${printer.name}`
      });
    } catch (error) {
      console.error('Test print failed:', error);
      toast({
        title: "Test print failed",
        description: errorMessage(error, "Could not send test to printer"),
        variant: "destructive"
      });
    } finally {
      setTimeout(() => setTestingPrinter(null), 2000);
    }
  };

  const togglePrinterActive = async (printer: Printer) => {
    try {
      await apiClient.snake.put(`/printers/${printer.id}`, { is_active: !printer.is_active });
      fetchData();
    } catch (error) {
      console.error('Error toggling printer:', error);
    }
  };

  const setAsDefault = async (printer: Printer) => {
    try {
      await apiClient.snake.put(`/printers/${printer.id}`, { is_default: true });

      toast({ title: `${printer.name} set as default` });
      fetchData();
    } catch (error) {
      console.error('Error setting default:', error);
    }
  };

  const togglePrintFor = (purpose: string) => {
    setFormData(prev => ({
      ...prev,
      print_for: prev.print_for.includes(purpose)
        ? prev.print_for.filter(p => p !== purpose)
        : [...prev.print_for, purpose]
    }));
  };

  const toggleCategory = (categoryId: string) => {
    setFormData(prev => ({
      ...prev,
      categories: prev.categories.includes(categoryId)
        ? prev.categories.filter(c => c !== categoryId)
        : [...prev.categories, categoryId]
    }));
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
          <h2 className="text-2xl font-bold text-foreground">Printer Management</h2>
          <p className="text-muted-foreground">Configure and manage printing devices</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={fetchData}>
            <RefreshCw className="w-4 h-4 mr-2" />
            Refresh
          </Button>
          <Button onClick={openAddDialog}>
            <Plus className="w-4 h-4 mr-2" />
            Add Printer
          </Button>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-4">
              <div className="p-3 rounded-xl bg-primary/10">
                <Printer className="w-6 h-6 text-primary" />
              </div>
              <div>
                <p className="text-2xl font-bold">{printers.length}</p>
                <p className="text-sm text-muted-foreground">Total Printers</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-4">
              <div className="p-3 rounded-xl bg-emerald-500/10">
                <CheckCircle2 className="w-6 h-6 text-emerald-500" />
              </div>
              <div>
                <p className="text-2xl font-bold">{printers.filter(p => p.is_active).length}</p>
                <p className="text-sm text-muted-foreground">Active</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-4">
              <div className="p-3 rounded-xl bg-blue-500/10">
                <Wifi className="w-6 h-6 text-blue-500" />
              </div>
              <div>
                <p className="text-2xl font-bold">{printers.filter(p => p.connection_type === 'network').length}</p>
                <p className="text-sm text-muted-foreground">Network</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-4">
              <div className="p-3 rounded-xl bg-amber-500/10">
                <Usb className="w-6 h-6 text-amber-500" />
              </div>
              <div>
                <p className="text-2xl font-bold">{printers.filter(p => p.connection_type === 'usb').length}</p>
                <p className="text-sm text-muted-foreground">USB</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Printers List */}
      {printers.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-16">
            <Printer className="w-16 h-16 text-muted-foreground/50 mb-4" />
            <h3 className="text-xl font-semibold mb-2">No Printers Configured</h3>
            <p className="text-muted-foreground text-center mb-4">
              Add your first printer to start printing KOTs and bills
            </p>
            <Button onClick={openAddDialog}>
              <Plus className="w-4 h-4 mr-2" />
              Add Printer
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {printers.map(printer => (
            <Card 
              key={printer.id}
              className={cn(
                "relative transition-all",
                !printer.is_active && "opacity-60",
                printer.is_default && "ring-2 ring-primary"
              )}
            >
              {printer.is_default && (
                <Badge className="absolute -top-2 -right-2 gap-1">
                  <Star className="w-3 h-3" />
                  Default
                </Badge>
              )}
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className={cn(
                      "p-3 rounded-xl",
                      printer.connection_type === 'network' 
                        ? "bg-blue-500/10" 
                        : "bg-amber-500/10"
                    )}>
                      {printer.connection_type === 'network' ? (
                        <Wifi className="w-6 h-6 text-blue-500" />
                      ) : (
                        <Usb className="w-6 h-6 text-amber-500" />
                      )}
                    </div>
                    <div>
                      <CardTitle className="text-base">{printer.name}</CardTitle>
                      <p className="text-sm text-muted-foreground capitalize">
                        {printer.type} Printer
                      </p>
                    </div>
                  </div>
                  <Switch
                    checked={printer.is_active}
                    onCheckedChange={() => togglePrinterActive(printer)}
                  />
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Connection Details */}
                <div className="p-3 rounded-lg bg-muted/50 text-sm">
                  {printer.connection_type === 'network' ? (
                    <div className="space-y-1">
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">IP Address</span>
                        <span className="font-mono">{printer.ip_address}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Port</span>
                        <span className="font-mono">{printer.port}</span>
                      </div>
                    </div>
                  ) : (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Connection</span>
                      <span>USB Direct</span>
                    </div>
                  )}
                </div>

                {/* Print Purposes */}
                {printer.print_for && printer.print_for.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {printer.print_for.map(purpose => (
                      <Badge key={purpose} variant="secondary" className="text-xs">
                        {purpose.toUpperCase()}
                      </Badge>
                    ))}
                  </div>
                )}

                {/* Actions */}
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="flex-1"
                    onClick={() => handleTestPrint(printer)}
                    disabled={testingPrinter === printer.id}
                  >
                    {testingPrinter === printer.id ? (
                      <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                    ) : (
                      <TestTube2 className="w-4 h-4 mr-1" />
                    )}
                    Test
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="flex-1"
                    onClick={() => openEditDialog(printer)}
                  >
                    <Edit2 className="w-4 h-4 mr-1" />
                    Edit
                  </Button>
                  {!printer.is_default && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setAsDefault(printer)}
                      title="Set as default"
                    >
                      <Star className="w-4 h-4" />
                    </Button>
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setSelectedPrinter(printer);
                      setIsDeleteOpen(true);
                    }}
                  >
                    <Trash2 className="w-4 h-4 text-destructive" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Add/Edit Dialog */}
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Settings2 className="w-5 h-5" />
              {selectedPrinter ? 'Edit Printer' : 'Add New Printer'}
            </DialogTitle>
            <DialogDescription>
              Configure printer settings and assign print purposes
            </DialogDescription>
          </DialogHeader>

          <Tabs defaultValue="general" className="mt-4">
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="general">General</TabsTrigger>
              <TabsTrigger value="connection">Connection</TabsTrigger>
              <TabsTrigger value="assignment">Assignment</TabsTrigger>
            </TabsList>

            <TabsContent value="general" className="space-y-4 mt-4">
              <div className="space-y-2">
                <Label htmlFor="name">Printer Name</Label>
                <Input
                  id="name"
                  value={formData.name}
                  onChange={e => setFormData(prev => ({ ...prev, name: e.target.value }))}
                  placeholder="e.g., Kitchen Printer 1"
                />
              </div>

              <div className="space-y-2">
                <Label>Printer Type</Label>
                <Select
                  value={formData.type}
                  onValueChange={value => setFormData(prev => ({ ...prev, type: value }))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PRINTER_TYPES.map(type => (
                      <SelectItem key={type.id} value={type.id}>
                        {type.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex items-center justify-between p-3 rounded-lg border">
                <div>
                  <Label>Set as Default</Label>
                  <p className="text-sm text-muted-foreground">
                    Use this printer when no specific printer is configured
                  </p>
                </div>
                <Switch
                  checked={formData.is_default}
                  onCheckedChange={checked => setFormData(prev => ({ ...prev, is_default: checked }))}
                />
              </div>
            </TabsContent>

            <TabsContent value="connection" className="space-y-4 mt-4">
              <div className="space-y-2">
                <Label>Connection Type</Label>
                <div className="grid grid-cols-2 gap-2">
                  {CONNECTION_TYPES.map(conn => (
                    <Button
                      key={conn.id}
                      type="button"
                      variant={formData.connection_type === conn.id ? 'default' : 'outline'}
                      className="h-20 flex-col gap-2"
                      onClick={() => setFormData(prev => ({ ...prev, connection_type: conn.id }))}
                    >
                      <conn.icon className="w-6 h-6" />
                      {conn.label}
                    </Button>
                  ))}
                </div>
              </div>

              {formData.connection_type === 'network' && (
                <>
                  <div className="space-y-2">
                    <Label htmlFor="ip">IP Address</Label>
                    <Input
                      id="ip"
                      value={formData.ip_address}
                      onChange={e => setFormData(prev => ({ ...prev, ip_address: e.target.value }))}
                      placeholder="192.168.1.100"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="port">Port</Label>
                    <Input
                      id="port"
                      type="number"
                      value={formData.port}
                      onChange={e => setFormData(prev => ({ ...prev, port: parseInt(e.target.value) || 9100 }))}
                      placeholder="9100"
                    />
                    <p className="text-xs text-muted-foreground">
                      Default port for most thermal printers is 9100
                    </p>
                  </div>
                </>
              )}

              {formData.connection_type === 'usb' && (
                <div className="p-4 rounded-lg bg-muted/50 text-sm">
                  <div className="flex items-start gap-3">
                    <AlertCircle className="w-5 h-5 text-muted-foreground mt-0.5" />
                    <div>
                      <p className="font-medium">USB Connection</p>
                      <p className="text-muted-foreground mt-1">
                        USB printers require a local print server or browser extension for direct printing. 
                        The printer must be connected to the POS terminal.
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </TabsContent>

            <TabsContent value="assignment" className="space-y-4 mt-4">
              <div className="space-y-3">
                <Label>Print Purposes</Label>
                <p className="text-sm text-muted-foreground">
                  Select what this printer should be used for
                </p>
                <div className="space-y-2">
                  {PRINT_PURPOSES.map(purpose => (
                    <div
                      key={purpose.id}
                      className={cn(
                        "flex items-center justify-between p-3 rounded-lg border cursor-pointer transition-colors",
                        formData.print_for.includes(purpose.id) && "bg-primary/5 border-primary/30"
                      )}
                      onClick={() => togglePrintFor(purpose.id)}
                    >
                      <div className="flex items-center gap-3">
                        <Checkbox checked={formData.print_for.includes(purpose.id)} />
                        <div>
                          <p className="font-medium text-sm">{purpose.label}</p>
                          <p className="text-xs text-muted-foreground">{purpose.description}</p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {formData.print_for.includes('kot') && categories.length > 0 && (
                <div className="space-y-3">
                  <Label>Menu Categories (for KOT)</Label>
                  <p className="text-sm text-muted-foreground">
                    Assign specific menu categories to this printer
                  </p>
                  <ScrollArea className="h-[120px] border rounded-lg p-2">
                    <div className="space-y-1">
                      {categories.map(category => (
                        <div
                          key={category.id}
                          className={cn(
                            "flex items-center gap-2 p-2 rounded cursor-pointer hover:bg-muted/50",
                            formData.categories.includes(category.id) && "bg-primary/10"
                          )}
                          onClick={() => toggleCategory(category.id)}
                        >
                          <Checkbox checked={formData.categories.includes(category.id)} />
                          <span className="text-sm">{category.name}</span>
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                </div>
              )}
            </TabsContent>
          </Tabs>

          <DialogFooter className="mt-6">
            <Button variant="outline" onClick={() => setIsDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSave}>
              {selectedPrinter ? 'Save Changes' : 'Add Printer'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog open={isDeleteOpen} onOpenChange={setIsDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Printer</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete "{selectedPrinter?.name}"? 
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={handleDelete}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
