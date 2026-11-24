'use client';

import { useState, useCallback } from 'react';
import { Users, Clock, MoreHorizontal, ArrowRight, Merge, QrCode, Scissors, Unlink } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useTables, useOrders, type TableWithOrder } from '@/hooks/useDatabase';
import { cn } from '@/lib/utils';
import { OrderPanel } from './OrderPanel';
import {
  TableShiftDialog,
  TableMergeDialog,
  TableSplitDialog,
  TableQRDialog,
} from './table-operations';
import { useWaiterRealtimeNotifications } from '@/hooks/useBranchRealtime';
import { useBranchId } from '@/hooks/useBranchId';

type TableStatus = 'available' | 'occupied' | 'reserved' | 'cleaning';

const statusConfig: Record<TableStatus, { label: string; className: string }> = {
  available: { label: 'Available', className: 'bg-status-available' },
  occupied: { label: 'Occupied', className: 'bg-status-occupied' },
  reserved: { label: 'Reserved', className: 'bg-status-reserved' },
  cleaning: { label: 'Cleaning', className: 'bg-status-cleaning' },
};

const areas = ['All', 'Main', 'Patio', 'Rooftop', 'Private', 'VIP'];

export function TableView() {
  const [selectedArea, setSelectedArea] = useState('All');
  const [showOrderPanel, setShowOrderPanel] = useState(false);
  const [selectedTable, setSelectedTable] = useState<TableWithOrder | null>(null);
  
  // Get default branch ID for single restaurant system
  const branchId = useBranchId();
  
  // Table operation dialogs
  const [shiftDialogOpen, setShiftDialogOpen] = useState(false);
  const [mergeDialogOpen, setMergeDialogOpen] = useState(false);
  const [splitDialogOpen, setSplitDialogOpen] = useState(false);
  const [qrDialogOpen, setQrDialogOpen] = useState(false);
  const [operationTable, setOperationTable] = useState<TableWithOrder | null>(null);

  // Use database hooks
  const { 
    tables, 
    loading, 
    updateTableStatus, 
    shiftTable, 
    mergeTables, 
    unmergeTables,
    fetchTables
  } = useTables();
  
  const { orders } = useOrders();

  // Real-time updates
  const { isConnected } = useWaiterRealtimeNotifications(fetchTables);

  const filteredTables = selectedArea === 'All' 
    ? tables 
    : tables.filter(t => t.area === selectedArea);

  const getTableOrder = useCallback((table: TableWithOrder) => {
    if (!table.current_order_id) return null;
    return orders.find(o => o.id === table.current_order_id);
  }, [orders]);

  const handleTableClick = (table: TableWithOrder) => {
    setSelectedTable(table);
    setShowOrderPanel(true);
  };

  const getTimeElapsed = (dateStr: string) => {
    const date = new Date(dateStr);
    const minutes = Math.floor((Date.now() - date.getTime()) / 60000);
    if (minutes < 60) return `${minutes}m`;
    const hours = Math.floor(minutes / 60);
    return `${hours}h ${minutes % 60}m`;
  };

  // Table operations handlers
  const handleOpenShift = (table: TableWithOrder, e: React.MouseEvent) => {
    e.stopPropagation();
    setOperationTable(table);
    setShiftDialogOpen(true);
  };

  const handleOpenMerge = (table: TableWithOrder, e: React.MouseEvent) => {
    e.stopPropagation();
    setOperationTable(table);
    setMergeDialogOpen(true);
  };

  const handleOpenSplit = (table: TableWithOrder, e: React.MouseEvent) => {
    e.stopPropagation();
    setOperationTable(table);
    setSplitDialogOpen(true);
  };

  const handleOpenQR = (table: TableWithOrder, e: React.MouseEvent) => {
    e.stopPropagation();
    setOperationTable(table);
    setQrDialogOpen(true);
  };

  const handleUnmerge = async (table: TableWithOrder, e: React.MouseEvent) => {
    e.stopPropagation();
    await unmergeTables(table.id);
  };

  // Get order items for split dialog
  const getOrderItems = () => {
    if (!operationTable?.current_order_id) return [];
    const order = orders.find(o => o.id === operationTable.current_order_id);
    if (!order?.order_items) return [];
    
    return order.order_items.map(item => ({
      id: item.id,
      name: item.menu_items?.name || 'Unknown Item',
      quantity: item.quantity || 1,
      unitPrice: item.unit_price,
    }));
  };

  // Handle split (placeholder - needs backend support for full implementation)
  const handleSplit = async (
    sourceTableId: string,
    targetTableId: string,
    itemIds: string[],
    quantities: Record<string, number>
  ) => {
    // This would require additional backend logic to:
    // 1. Create a new order for the target table
    // 2. Move selected items to the new order
    // 3. Update table statuses
    console.log('Split operation:', { sourceTableId, targetTableId, itemIds, quantities });
    // For now, just refresh tables
    await fetchTables();
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  return (
    <div className="flex h-full">
      <div className={cn(
        "flex-1 p-6 transition-all duration-300",
        showOrderPanel && "lg:pr-[400px]"
      )}>
        {/* Connection Status */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <div className={cn(
              "w-2 h-2 rounded-full",
              isConnected ? "bg-status-available" : "bg-status-occupied"
            )} />
            <span className="text-xs text-muted-foreground">
              {isConnected ? 'Live updates active' : 'Reconnecting...'}
            </span>
          </div>
          <Badge variant="outline" className="text-xs">
            {tables.length} tables
          </Badge>
        </div>

        {/* Area Filter */}
        <div className="flex items-center gap-2 mb-6 overflow-x-auto pb-2">
          {areas.map(area => (
            <Button
              key={area}
              variant={selectedArea === area ? "default" : "outline"}
              size="sm"
              onClick={() => setSelectedArea(area)}
              className={cn(
                "shrink-0",
                selectedArea === area && "bg-primary text-primary-foreground"
              )}
            >
              {area}
            </Button>
          ))}
        </div>

        {/* Status Legend */}
        <div className="flex items-center gap-4 mb-6 flex-wrap">
          {Object.entries(statusConfig).map(([status, config]) => (
            <div key={status} className="flex items-center gap-2">
              <div className={cn("w-3 h-3 rounded-full", config.className)} />
              <span className="text-sm text-muted-foreground">{config.label}</span>
            </div>
          ))}
        </div>

        {/* Tables Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
          {filteredTables.map((table) => {
            const order = getTableOrder(table);
            const status = (table.status || 'available') as TableStatus;
            const config = statusConfig[status];
            const isMerged = table.merged_with && table.merged_with.length > 0;

            return (
              <Card
                key={table.id}
                onClick={() => handleTableClick(table)}
                className={cn(
                  "table-card cursor-pointer border-2 transition-all duration-200 hover:shadow-lg",
                  selectedTable?.id === table.id 
                    ? "border-primary ring-2 ring-primary/20" 
                    : "border-transparent",
                  status === 'available' && "hover:border-status-available/50",
                  status === 'occupied' && "hover:border-status-occupied/50",
                  isMerged && "ring-2 ring-primary/30"
                )}
              >
                <CardContent className="p-4">
                  <div className="flex items-start justify-between mb-3">
                    <div className={cn(
                      "w-12 h-12 rounded-xl flex items-center justify-center relative",
                      config.className
                    )}>
                      <span className="text-xl text-white font-bold">
                        {table.table_number}
                      </span>
                      {isMerged && (
                        <Badge 
                          className="absolute -top-2 -right-2 h-5 w-5 p-0 flex items-center justify-center bg-primary text-[10px]"
                        >
                          +{table.merged_with?.length}
                        </Badge>
                      )}
                    </div>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={e => e.stopPropagation()}>
                          <MoreHorizontal className="w-4 h-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={(e) => { e.stopPropagation(); updateTableStatus(table.id, 'available'); }}>
                          Mark Available
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={(e) => { e.stopPropagation(); updateTableStatus(table.id, 'reserved'); }}>
                          Reserve Table
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={(e) => { e.stopPropagation(); updateTableStatus(table.id, 'cleaning'); }}>
                          Mark Cleaning
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        {status === 'occupied' && order && (
                          <>
                            <DropdownMenuItem onClick={(e) => handleOpenShift(table, e)}>
                              <ArrowRight className="w-4 h-4 mr-2" />
                              Shift Table
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={(e) => handleOpenSplit(table, e)}>
                              <Scissors className="w-4 h-4 mr-2" />
                              Split Bill
                            </DropdownMenuItem>
                          </>
                        )}
                        {isMerged ? (
                          <DropdownMenuItem onClick={(e) => handleUnmerge(table, e)}>
                            <Unlink className="w-4 h-4 mr-2" />
                            Unmerge Tables
                          </DropdownMenuItem>
                        ) : (
                          <DropdownMenuItem onClick={(e) => handleOpenMerge(table, e)}>
                            <Merge className="w-4 h-4 mr-2" />
                            Merge Tables
                          </DropdownMenuItem>
                        )}
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onClick={(e) => handleOpenQR(table, e)}>
                          <QrCode className="w-4 h-4 mr-2" />
                          Show QR Code
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Users className="w-4 h-4" />
                      <span>{table.capacity} seats</span>
                    </div>
                    
                    {order && (
                      <>
                        <div className="flex items-center gap-2 text-sm text-muted-foreground">
                          <Clock className="w-4 h-4" />
                          <span>{getTimeElapsed(order.created_at || '')}</span>
                        </div>
                        <div className="pt-2 border-t border-border">
                          <p className="text-xs text-muted-foreground mb-1">
                            {order.order_number}
                          </p>
                          <p className="font-bold text-foreground">
                            ₹{(order.total || 0).toFixed(0)}
                          </p>
                        </div>
                      </>
                    )}

                    {!order && status === 'available' && (
                      <Badge variant="outline" className="bg-status-available/10 text-status-available border-status-available/30 w-full justify-center mt-2">
                        Ready for guests
                      </Badge>
                    )}

                    {isMerged && (
                      <Badge variant="outline" className="bg-primary/10 text-primary border-primary/30 w-full justify-center mt-2">
                        Merged
                      </Badge>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>

      {/* Order Panel */}
      {showOrderPanel && selectedTable && (
        <OrderPanel 
          table={{
            id: selectedTable.id,
            branchId: branchId || '',
            number: selectedTable.table_number,
            capacity: selectedTable.capacity || 4,
            status: (selectedTable.status || 'available') as TableStatus,
            area: selectedTable.area || 'Main',
            floor: selectedTable.floor || 'Ground',
            currentOrderId: selectedTable.current_order_id || undefined,
          }}
          onClose={() => {
            setShowOrderPanel(false);
            setSelectedTable(null);
          }}
        />
      )}

      {/* Table Operation Dialogs */}
      <TableShiftDialog
        open={shiftDialogOpen}
        onOpenChange={setShiftDialogOpen}
        sourceTable={operationTable}
        tables={tables}
        onShift={shiftTable}
      />

      <TableMergeDialog
        open={mergeDialogOpen}
        onOpenChange={setMergeDialogOpen}
        primaryTable={operationTable}
        tables={tables}
        onMerge={mergeTables}
      />

      <TableSplitDialog
        open={splitDialogOpen}
        onOpenChange={setSplitDialogOpen}
        table={operationTable}
        orderItems={getOrderItems()}
        tables={tables}
        onSplit={handleSplit}
      />

      <TableQRDialog
        open={qrDialogOpen}
        onOpenChange={setQrDialogOpen}
        table={operationTable}
        branchId={branchId || ''}
      />
    </div>
  );
}
