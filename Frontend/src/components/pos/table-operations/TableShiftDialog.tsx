'use client';

import { useState } from 'react';
import { ArrowRight, Check } from 'lucide-react';
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

interface TableShiftDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sourceTable: TableWithOrder | null;
  tables: TableWithOrder[];
  onShift: (fromTableId: string, toTableId: string) => Promise<void>;
}

export function TableShiftDialog({
  open,
  onOpenChange,
  sourceTable,
  tables,
  onShift,
}: TableShiftDialogProps) {
  const [selectedTarget, setSelectedTarget] = useState<string | null>(null);
  const [isShifting, setIsShifting] = useState(false);

  // Only show available tables as targets
  const availableTables = tables.filter(
    (t) => t.id !== sourceTable?.id && t.status === 'available'
  );

  const handleShift = async () => {
    if (!sourceTable || !selectedTarget) return;

    setIsShifting(true);
    try {
      await onShift(sourceTable.id, selectedTarget);
      onOpenChange(false);
      setSelectedTarget(null);
    } finally {
      setIsShifting(false);
    }
  };

  const handleClose = () => {
    setSelectedTarget(null);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ArrowRight className="h-5 w-5 text-primary" />
            Shift Table
          </DialogTitle>
          <DialogDescription>
            Move all orders from Table {sourceTable?.table_number} to another table.
          </DialogDescription>
        </DialogHeader>

        <div className="py-4">
          <div className="flex items-center justify-center gap-4 mb-6">
            <div className="flex flex-col items-center">
              <div className="w-16 h-16 rounded-xl bg-status-occupied flex items-center justify-center">
                <span className="text-xl font-bold text-white">
                  {sourceTable?.table_number}
                </span>
              </div>
              <span className="text-xs text-muted-foreground mt-2">From</span>
            </div>
            <ArrowRight className="h-6 w-6 text-muted-foreground" />
            <div className="flex flex-col items-center">
              <div
                className={cn(
                  'w-16 h-16 rounded-xl flex items-center justify-center border-2 border-dashed',
                  selectedTarget
                    ? 'bg-status-available border-status-available'
                    : 'border-muted-foreground'
                )}
              >
                {selectedTarget ? (
                  <span className="text-xl font-bold text-white">
                    {tables.find((t) => t.id === selectedTarget)?.table_number}
                  </span>
                ) : (
                  <span className="text-sm text-muted-foreground">?</span>
                )}
              </div>
              <span className="text-xs text-muted-foreground mt-2">To</span>
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Select destination table:</label>
            <ScrollArea className="h-48 rounded-md border p-2">
              {availableTables.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">
                  No available tables to shift to
                </p>
              ) : (
                <div className="grid grid-cols-4 gap-2">
                  {availableTables.map((table) => (
                    <Button
                      key={table.id}
                      variant={selectedTarget === table.id ? 'default' : 'outline'}
                      size="sm"
                      onClick={() => setSelectedTarget(table.id)}
                      className={cn(
                        'relative h-12',
                        selectedTarget === table.id &&
                          'bg-status-available hover:bg-status-available/90'
                      )}
                    >
                      {table.table_number}
                      {selectedTarget === table.id && (
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
            onClick={handleShift}
            disabled={!selectedTarget || isShifting}
            className="bg-primary"
          >
            {isShifting ? 'Shifting...' : 'Shift Table'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
