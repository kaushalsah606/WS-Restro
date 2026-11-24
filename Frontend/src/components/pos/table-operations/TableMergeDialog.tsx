'use client';

import { useState } from 'react';
import { Merge, Check, X } from 'lucide-react';
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
import { cn } from '@/lib/utils';
import type { TableWithOrder } from '@/hooks/useDatabase';

interface TableMergeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  primaryTable: TableWithOrder | null;
  tables: TableWithOrder[];
  onMerge: (tableIds: string[], primaryTableId: string) => Promise<void>;
}

export function TableMergeDialog({
  open,
  onOpenChange,
  primaryTable,
  tables,
  onMerge,
}: TableMergeDialogProps) {
  const [selectedTables, setSelectedTables] = useState<string[]>([]);
  const [isMerging, setIsMerging] = useState(false);

  // Tables that can be merged (available or occupied, not cleaning/reserved)
  const mergeableTables = tables.filter(
    (t) =>
      t.id !== primaryTable?.id &&
      (t.status === 'available' || t.status === 'occupied') &&
      !t.merged_with?.length
  );

  const toggleTable = (tableId: string) => {
    setSelectedTables((prev) =>
      prev.includes(tableId)
        ? prev.filter((id) => id !== tableId)
        : [...prev, tableId]
    );
  };

  const handleMerge = async () => {
    if (!primaryTable || selectedTables.length === 0) return;

    setIsMerging(true);
    try {
      const allTableIds = [primaryTable.id, ...selectedTables];
      await onMerge(allTableIds, primaryTable.id);
      onOpenChange(false);
      setSelectedTables([]);
    } finally {
      setIsMerging(false);
    }
  };

  const handleClose = () => {
    setSelectedTables([]);
    onOpenChange(false);
  };

  const getTotalCapacity = () => {
    const primaryCapacity = primaryTable?.capacity || 0;
    const selectedCapacity = selectedTables.reduce((sum, id) => {
      const table = tables.find((t) => t.id === id);
      return sum + (table?.capacity || 0);
    }, 0);
    return primaryCapacity + selectedCapacity;
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Merge className="h-5 w-5 text-primary" />
            Merge Tables
          </DialogTitle>
          <DialogDescription>
            Combine Table {primaryTable?.table_number} with other tables. All orders
            will be consolidated under the primary table.
          </DialogDescription>
        </DialogHeader>

        <div className="py-4 space-y-4">
          {/* Selected tables preview */}
          <div className="flex flex-wrap items-center gap-2 p-3 rounded-lg bg-muted/50">
            <Badge className="bg-primary">
              {primaryTable?.table_number} (Primary)
            </Badge>
            {selectedTables.map((id) => {
              const table = tables.find((t) => t.id === id);
              return (
                <Badge
                  key={id}
                  variant="outline"
                  className="cursor-pointer hover:bg-destructive hover:text-destructive-foreground"
                  onClick={() => toggleTable(id)}
                >
                  {table?.table_number}
                  <X className="h-3 w-3 ml-1" />
                </Badge>
              );
            })}
            {selectedTables.length === 0 && (
              <span className="text-sm text-muted-foreground">
                Select tables to merge...
              </span>
            )}
          </div>

          {/* Total capacity */}
          <div className="text-sm text-muted-foreground">
            Combined capacity: <strong>{getTotalCapacity()} seats</strong>
          </div>

          {/* Table selection */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Select tables to merge:</label>
            <ScrollArea className="h-56 rounded-md border p-2">
              {mergeableTables.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">
                  No tables available to merge
                </p>
              ) : (
                <div className="grid grid-cols-4 gap-2">
                  {mergeableTables.map((table) => {
                    const isSelected = selectedTables.includes(table.id);
                    return (
                      <Button
                        key={table.id}
                        variant={isSelected ? 'default' : 'outline'}
                        size="sm"
                        onClick={() => toggleTable(table.id)}
                        className={cn(
                          'relative h-14 flex-col gap-0.5',
                          isSelected && 'bg-primary hover:bg-primary/90'
                        )}
                      >
                        <span className="font-bold">{table.table_number}</span>
                        <span className="text-xs opacity-70">
                          {table.capacity} seats
                        </span>
                        {isSelected && (
                          <Check className="absolute top-1 right-1 h-3 w-3" />
                        )}
                      </Button>
                    );
                  })}
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
            onClick={handleMerge}
            disabled={selectedTables.length === 0 || isMerging}
            className="bg-primary"
          >
            {isMerging
              ? 'Merging...'
              : `Merge ${selectedTables.length + 1} Tables`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
