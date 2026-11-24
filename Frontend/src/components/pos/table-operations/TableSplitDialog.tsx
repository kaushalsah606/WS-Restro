'use client';

import { useState } from 'react';
import { Scissors, Check, Minus, Plus } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Checkbox } from '@/components/ui/checkbox';
import { cn } from '@/lib/utils';
import type { TableWithOrder } from '@/hooks/useDatabase';

interface OrderItem {
  id: string;
  name: string;
  quantity: number;
  unitPrice: number;
}

interface TableSplitDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  table: TableWithOrder | null;
  orderItems: OrderItem[];
  tables: TableWithOrder[];
  onSplit: (
    sourceTableId: string,
    targetTableId: string,
    itemIds: string[],
    quantities: Record<string, number>
  ) => Promise<void>;
}

export function TableSplitDialog({
  open,
  onOpenChange,
  table,
  orderItems,
  tables,
  onSplit,
}: TableSplitDialogProps) {
  const [selectedItems, setSelectedItems] = useState<Record<string, number>>({});
  const [selectedTarget, setSelectedTarget] = useState<string | null>(null);
  const [isSplitting, setIsSplitting] = useState(false);

  // Only show available tables as targets
  const availableTables = tables.filter(
    (t) => t.id !== table?.id && t.status === 'available'
  );

  const toggleItem = (itemId: string, maxQty: number) => {
    setSelectedItems((prev) => {
      if (prev[itemId]) {
        const { [itemId]: _, ...rest } = prev;
        return rest;
      }
      return { ...prev, [itemId]: 1 };
    });
  };

  const updateQuantity = (itemId: string, delta: number, maxQty: number) => {
    setSelectedItems((prev) => {
      const current = prev[itemId] || 0;
      const newQty = Math.max(1, Math.min(maxQty, current + delta));
      return { ...prev, [itemId]: newQty };
    });
  };

  const handleSplit = async () => {
    if (!table || !selectedTarget || Object.keys(selectedItems).length === 0) return;

    setIsSplitting(true);
    try {
      await onSplit(
        table.id,
        selectedTarget,
        Object.keys(selectedItems),
        selectedItems
      );
      onOpenChange(false);
      setSelectedItems({});
      setSelectedTarget(null);
    } finally {
      setIsSplitting(false);
    }
  };

  const handleClose = () => {
    setSelectedItems({});
    setSelectedTarget(null);
    onOpenChange(false);
  };

  const getSplitTotal = () => {
    return Object.entries(selectedItems).reduce((sum, [itemId, qty]) => {
      const item = orderItems.find((i) => i.id === itemId);
      return sum + (item?.unitPrice || 0) * qty;
    }, 0);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Scissors className="h-5 w-5 text-primary" />
            Split Bill / Table
          </DialogTitle>
          <DialogDescription>
            Select items to move to another table for separate billing.
          </DialogDescription>
        </DialogHeader>

        <div className="py-4 space-y-4">
          {/* Items selection */}
          <div className="space-y-2">
            <label className="text-sm font-medium">
              Select items to split from Table {table?.table_number}:
            </label>
            <ScrollArea className="h-48 rounded-md border">
              {orderItems.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">
                  No items to split
                </p>
              ) : (
                <div className="p-2 space-y-2">
                  {orderItems.map((item) => {
                    const isSelected = !!selectedItems[item.id];
                    const selectedQty = selectedItems[item.id] || 0;

                    return (
                      <div
                        key={item.id}
                        className={cn(
                          'flex items-center justify-between p-3 rounded-lg border transition-colors',
                          isSelected
                            ? 'border-primary bg-primary/5'
                            : 'border-transparent bg-muted/50'
                        )}
                      >
                        <div className="flex items-center gap-3">
                          <Checkbox
                            checked={isSelected}
                            onCheckedChange={() => toggleItem(item.id, item.quantity)}
                          />
                          <div>
                            <p className="font-medium">{item.name}</p>
                            <p className="text-sm text-muted-foreground">
                              ₹{item.unitPrice} × {item.quantity}
                            </p>
                          </div>
                        </div>

                        {isSelected && (
                          <div className="flex items-center gap-2">
                            <Button
                              variant="outline"
                              size="icon"
                              className="h-8 w-8"
                              onClick={() =>
                                updateQuantity(item.id, -1, item.quantity)
                              }
                              disabled={selectedQty <= 1}
                            >
                              <Minus className="h-4 w-4" />
                            </Button>
                            <span className="w-8 text-center font-medium">
                              {selectedQty}
                            </span>
                            <Button
                              variant="outline"
                              size="icon"
                              className="h-8 w-8"
                              onClick={() =>
                                updateQuantity(item.id, 1, item.quantity)
                              }
                              disabled={selectedQty >= item.quantity}
                            >
                              <Plus className="h-4 w-4" />
                            </Button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </ScrollArea>
          </div>

          {/* Split total */}
          {Object.keys(selectedItems).length > 0 && (
            <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
              <span className="text-sm font-medium">Split amount:</span>
              <span className="text-lg font-bold text-primary">
                ₹{getSplitTotal().toFixed(0)}
              </span>
            </div>
          )}

          {/* Target table selection */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Move items to table:</label>
            <ScrollArea className="h-28 rounded-md border p-2">
              {availableTables.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">
                  No available tables
                </p>
              ) : (
                <div className="grid grid-cols-5 gap-2">
                  {availableTables.map((t) => (
                    <Button
                      key={t.id}
                      variant={selectedTarget === t.id ? 'default' : 'outline'}
                      size="sm"
                      onClick={() => setSelectedTarget(t.id)}
                      className={cn(
                        'relative h-10',
                        selectedTarget === t.id &&
                          'bg-status-available hover:bg-status-available/90'
                      )}
                    >
                      {t.table_number}
                      {selectedTarget === t.id && (
                        <Check className="absolute top-1 right-1 h-3 w-3" />
                      )}
                    </Button>
                  ))}
                </div>
              )}
            </ScrollArea>
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={handleClose}>
            Cancel
          </Button>
          <Button
            onClick={handleSplit}
            disabled={
              Object.keys(selectedItems).length === 0 ||
              !selectedTarget ||
              isSplitting
            }
            className="bg-primary"
          >
            {isSplitting ? 'Splitting...' : 'Split & Move'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
