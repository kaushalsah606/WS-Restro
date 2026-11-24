'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  DndContext,
  DragEndEvent,
  DragStartEvent,
  useSensor,
  useSensors,
  PointerSensor,
  closestCenter
} from '@dnd-kit/core';
import {
  Users,
  Clock,
  MoreHorizontal,
  ArrowRight,
  Merge,
  QrCode,
  GripVertical,
  Plus,
  Settings,
  Loader2
} from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { OrderPanel } from './OrderPanel';
import { useToast } from '@/hooks/use-toast';

// Local type definitions
type DbTable = {
  id: string;
  table_number: string;
  status: string;
  current_order_id?: string | null;
  [key: string]: any;
};

type DbOrder = {
  id: string;
  status: string;
  [key: string]: any;
};

type TableStatus = 'available' | 'occupied' | 'reserved' | 'cleaning';

const statusConfig: Record<TableStatus, { label: string; className: string }> = {
  available: { label: 'Available', className: 'bg-status-available' },
  occupied: { label: 'Occupied', className: 'bg-status-occupied' },
  reserved: { label: 'Reserved', className: 'bg-status-reserved' },
  cleaning: { label: 'Cleaning', className: 'bg-status-cleaning' },
};

const areas = ['All', 'Main Hall', 'Patio', 'Rooftop', 'Private', 'VIP'];

// Branch ID comes from user context via useBranchId hook
import { useBranchId } from '@/hooks/useBranchId';
import { useTables, useOrders } from '@/hooks/useDatabase';
interface TableCardProps {
  table: DbTable;
  order: DbOrder | null;
  isSelected: boolean;
  onClick: () => void;
  onUpdateStatus: (status: TableStatus) => void;
  onShowQR: () => void;
  onShift: () => void;
  onMerge: () => void;
}

function TableCard({
  table,
  order,
  isSelected,
  onClick,
  onUpdateStatus,
  onShowQR,
  onShift,
  onMerge,
}: TableCardProps) {
  const config = statusConfig[table.status as TableStatus] || statusConfig.available;

  const getTimeElapsed = (date: string) => {
    const minutes = Math.floor((Date.now() - new Date(date).getTime()) / 60000);
    if (minutes < 60) return `${minutes}m`;
    const hours = Math.floor(minutes / 60);
    return `${hours}h ${minutes % 60}m`;
  };

  return (
    <Card
      onClick={onClick}
      className={cn(
        "table-card cursor-pointer border-2 transition-all duration-200 hover:shadow-lg relative",
        isSelected ? "border-primary ring-2 ring-primary/20" : "border-transparent",
        table.status === 'available' && "hover:border-status-available/50",
        table.status === 'occupied' && "hover:border-status-occupied/50",
      )}
    >
      <CardContent className="p-4">
        <div className="flex items-start justify-between mb-3">
          <div className="flex items-center gap-2">
            <div className="cursor-grab active:cursor-grabbing p-1 -ml-1 text-muted-foreground hover:text-foreground">
              <GripVertical className="w-4 h-4" />
            </div>
            <div className={cn(
              "w-12 h-12 rounded-xl flex items-center justify-center",
              config.className
            )}>
              <span className="table-number text-xl text-white">
                {table.table_number}
              </span>
            </div>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={e => e.stopPropagation()}>
                <MoreHorizontal className="w-4 h-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => onUpdateStatus('available')}>
                Mark Available
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => onUpdateStatus('reserved')}>
                Reserve Table
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => onUpdateStatus('cleaning')}>
                Mark Cleaning
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={onShift}>
                <ArrowRight className="w-4 h-4 mr-2" />
                Shift Order
              </DropdownMenuItem>
              <DropdownMenuItem onClick={onMerge}>
                <Merge className="w-4 h-4 mr-2" />
                Merge Tables
              </DropdownMenuItem>
              <DropdownMenuItem onClick={onShowQR}>
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
                <span>{getTimeElapsed(order.created_at)}</span>
              </div>
              <div className="pt-2 border-t border-border">
                <p className="text-xs text-muted-foreground mb-1">
                  {order.order_number}
                </p>
                <p className="font-bold text-foreground">
                  ₹{Number(order.total).toFixed(0)}
                </p>
              </div>
            </>
          )}

          {!order && table.status === 'available' && (
            <Badge variant="outline" className="bg-status-available/10 text-status-available border-status-available/30 w-full justify-center mt-2">
              Ready for guests
            </Badge>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export function FloorLayoutEditor() {
  const [selectedArea, setSelectedArea] = useState('All');
  const [showOrderPanel, setShowOrderPanel] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [selectedTable, setSelectedTable] = useState<DbTable | null>(null);
  const [qrDialogOpen, setQrDialogOpen] = useState(false);
  const [qrTable, setQrTable] = useState<DbTable | null>(null);
  const [shiftMode, setShiftMode] = useState(false);
  const [shiftFromTable, setShiftFromTable] = useState<DbTable | null>(null);
  const [mergeMode, setMergeMode] = useState(false);
  const [mergeTables, setMergeTables] = useState<DbTable[]>([]);

  const { toast } = useToast();

  const { tables, loading: tablesLoading, updateTableStatus, shiftTable, mergeTables: mergeTablesApi } = useTables();
  const { orders, loading: ordersLoading } = useOrders();

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 10,
      },
    })
  );

  const filteredTables = useMemo(() => {
    return selectedArea === 'All'
      ? tables
      : tables.filter(t => t.area === selectedArea);
  }, [tables, selectedArea]);

  const getTableOrder = useCallback((table: DbTable): DbOrder | null => {
    if (!table.current_order_id) return null;
    return orders.find(o => o.id === table.current_order_id) || null;
  }, [orders]);

  const handleTableClick = (table: DbTable) => {
    if (shiftMode && shiftFromTable) {
      if (table.id !== shiftFromTable.id && table.status === 'available') {
        shiftTable(shiftFromTable.id, table.id);
        setShiftMode(false);
        setShiftFromTable(null);
      } else if (table.status !== 'available') {
        toast({
          title: "Cannot shift",
          description: "Target table must be available",
          variant: "destructive",
        });
      }
      return;
    }

    if (mergeMode) {
      const isAlreadySelected = mergeTables.some(t => t.id === table.id);
      if (isAlreadySelected) {
        setMergeTables(prev => prev.filter(t => t.id !== table.id));
      } else {
        setMergeTables(prev => [...prev, table]);
      }
      return;
    }

    setSelectedTable(table);
    setShowOrderPanel(true);
  };

  const handleShowQR = (table: DbTable) => {
    setQrTable(table);
    setQrDialogOpen(true);
  };

  const handleStartShift = (table: DbTable) => {
    if (!table.current_order_id) {
      toast({
        title: "No order",
        description: "This table has no active order to shift",
        variant: "destructive",
      });
      return;
    }
    setShiftMode(true);
    setShiftFromTable(table);
    toast({
      title: "Shift mode",
      description: "Click on an available table to move the order",
    });
  };

  const handleStartMerge = (table: DbTable) => {
    setMergeMode(true);
    setMergeTables([table]);
    toast({
      title: "Merge mode",
      description: "Select tables to merge, then confirm",
    });
  };

  const confirmMerge = () => {
    if (mergeTables.length < 2) {
      toast({
        title: "Select more tables",
        description: "You need at least 2 tables to merge",
        variant: "destructive",
      });
      return;
    }

    // first selected table becomes the primary one
    const ids = mergeTables.map(t => t.id);
    mergeTablesApi(ids, ids[0])
      .then(() => {
        setMergeMode(false);
        setMergeTables([]);
      })
      .catch(() => undefined); // the hook already showed the error toast
  };

  const cancelMerge = () => {
    setMergeMode(false);
    setMergeTables([]);
  };

  const handleDragStart = (event: DragStartEvent) => {
    // Handle drag start
  };

  const handleDragEnd = (event: DragEndEvent) => {
    // Handle drag end - update positions
  };

  const getQRUrl = (table: DbTable) => {
    const baseUrl = window.location.origin;
    return `${baseUrl}/order?table=${table.id}&branch=${table.branch_id}`;
  };

  if (tablesLoading || ordersLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="flex h-full">
      <div className={cn(
        "flex-1 p-6 transition-all duration-300",
        showOrderPanel && "lg:pr-[400px]"
      )}>
        {/* Toolbar */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-2 overflow-x-auto pb-2">
            {areas.map(area => (
              <Button
                key={area}
                variant={selectedArea === area ? "default" : "outline"}
                size="sm"
                onClick={() => setSelectedArea(area)}
                className="shrink-0"
              >
                {area}
              </Button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            {shiftMode && (
              <Button variant="outline" size="sm" onClick={() => { setShiftMode(false); setShiftFromTable(null); }}>
                Cancel Shift
              </Button>
            )}
            {mergeMode && (
              <>
                <Button variant="outline" size="sm" onClick={cancelMerge}>
                  Cancel
                </Button>
                <Button size="sm" onClick={confirmMerge}>
                  Confirm Merge ({mergeTables.length})
                </Button>
              </>
            )}
            <Button
              variant={editMode ? "default" : "outline"}
              size="sm"
              onClick={() => setEditMode(!editMode)}
            >
              <Settings className="w-4 h-4 mr-2" />
              {editMode ? 'Done Editing' : 'Edit Layout'}
            </Button>
          </div>
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
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
        >
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
            {filteredTables.map((table) => {
              const order = getTableOrder(table);
              const isMergeSelected = mergeTables.some(t => t.id === table.id);

              return (
                <div
                  key={table.id}
                  className={cn(
                    "relative",
                    isMergeSelected && "ring-2 ring-primary rounded-lg"
                  )}
                >
                  <TableCard
                    table={table}
                    order={order}
                    isSelected={selectedTable?.id === table.id}
                    onClick={() => handleTableClick(table)}
                    onUpdateStatus={(status) => updateTableStatus(table.id, status)}
                    onShowQR={() => handleShowQR(table)}
                    onShift={() => handleStartShift(table)}
                    onMerge={() => handleStartMerge(table)}
                  />
                </div>
              );
            })}

            {editMode && (
              <Card className="border-2 border-dashed border-muted-foreground/30 flex items-center justify-center min-h-[150px] cursor-pointer hover:border-primary/50 transition-colors">
                <div className="text-center text-muted-foreground">
                  <Plus className="w-8 h-8 mx-auto mb-2" />
                  <span className="text-sm">Add Table</span>
                </div>
              </Card>
            )}
          </div>
        </DndContext>

        {tables.length === 0 && (
          <div className="text-center py-12 text-muted-foreground">
            <p>No tables found. Create tables from the settings.</p>
          </div>
        )}
      </div>

      {/* Order Panel - using mock store for now */}
      {showOrderPanel && selectedTable && (
        <OrderPanel
          table={{
            id: selectedTable.id,
            branchId: selectedTable.branch_id,
            number: selectedTable.table_number,
            capacity: selectedTable.capacity,
            floor: selectedTable.floor,
            area: selectedTable.area,
            status: selectedTable.status as any,
            currentOrderId: selectedTable.current_order_id || undefined,
          }}
          onClose={() => {
            setShowOrderPanel(false);
            setSelectedTable(null);
          }}
        />
      )}

      {/* QR Code Dialog */}
      <Dialog open={qrDialogOpen} onOpenChange={setQrDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Table {qrTable?.table_number} QR Code</DialogTitle>
            <DialogDescription>
              Scan this QR code to order from this table
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col items-center py-6">
            {qrTable && (
              <>
                <div className="p-4 bg-white rounded-xl">
                  <QRCodeSVG
                    value={getQRUrl(qrTable)}
                    size={200}
                    level="H"
                    includeMargin
                  />
                </div>
                <p className="text-xs text-muted-foreground mt-4 break-all text-center max-w-[250px]">
                  {getQRUrl(qrTable)}
                </p>
              </>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setQrDialogOpen(false)}>
              Close
            </Button>
            <Button onClick={() => {
              if (qrTable) {
                navigator.clipboard.writeText(getQRUrl(qrTable));
                toast({ title: "Copied!", description: "QR URL copied to clipboard" });
              }
            }}>
              Copy URL
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
