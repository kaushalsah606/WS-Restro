'use client';

import { useState, useEffect } from 'react';
import {
  Printer,
  RefreshCw,
  X,
  Check,
  AlertCircle,
  Loader2,
  ChevronDown,
  ChevronUp
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { cn } from '@/lib/utils';
import { printQueue, type PrintJob } from '@/services/printerService';

export function PrintQueuePanel() {
  const [jobs, setJobs] = useState<PrintJob[]>([]);
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    const unsubscribe = printQueue.subscribe(setJobs);
    return unsubscribe;
  }, []);

  const pendingCount = jobs.filter(j => j.status === 'pending' || j.status === 'printing').length;
  const failedCount = jobs.filter(j => j.status === 'failed').length;

  const getStatusIcon = (status: PrintJob['status']) => {
    switch (status) {
      case 'pending':
        return <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />;
      case 'printing':
        return <Loader2 className="w-4 h-4 animate-spin text-primary" />;
      case 'completed':
        return <Check className="w-4 h-4 text-emerald-500" />;
      case 'failed':
        return <AlertCircle className="w-4 h-4 text-destructive" />;
    }
  };

  const getStatusBadge = (status: PrintJob['status']) => {
    const variants: Record<PrintJob['status'], string> = {
      pending: 'bg-muted text-muted-foreground',
      printing: 'bg-primary/10 text-primary',
      completed: 'bg-emerald-500/10 text-emerald-600',
      failed: 'bg-destructive/10 text-destructive',
    };

    return (
      <Badge variant="outline" className={cn('capitalize', variants[status])}>
        {status}
      </Badge>
    );
  };

  if (jobs.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50">
      <Collapsible open={isOpen} onOpenChange={setIsOpen}>
        <CollapsibleTrigger asChild>
          <Button 
            variant="outline" 
            className={cn(
              "gap-2 shadow-lg",
              failedCount > 0 && "border-destructive/50"
            )}
          >
            <Printer className="w-4 h-4" />
            Print Queue
            {pendingCount > 0 && (
              <Badge variant="secondary" className="ml-1">
                {pendingCount}
              </Badge>
            )}
            {failedCount > 0 && (
              <Badge variant="destructive" className="ml-1">
                {failedCount} failed
              </Badge>
            )}
            {isOpen ? (
              <ChevronDown className="w-4 h-4" />
            ) : (
              <ChevronUp className="w-4 h-4" />
            )}
          </Button>
        </CollapsibleTrigger>

        <CollapsibleContent>
          <div className="mt-2 w-80 bg-popover border rounded-lg shadow-xl">
            <div className="p-3 border-b flex items-center justify-between">
              <span className="font-medium text-sm">Print Jobs</span>
              <span className="text-xs text-muted-foreground">
                {jobs.length} total
              </span>
            </div>

            <ScrollArea className="max-h-64">
              <div className="p-2 space-y-2">
                {jobs.map(job => (
                  <div
                    key={job.id}
                    className={cn(
                      "p-3 rounded-lg border text-sm",
                      job.status === 'failed' && "border-destructive/30 bg-destructive/5"
                    )}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2">
                        {getStatusIcon(job.status)}
                        <div>
                          <p className="font-medium capitalize">{job.type}</p>
                          <p className="text-xs text-muted-foreground">
                            {job.content.title || job.content.header?.[0]}
                          </p>
                        </div>
                      </div>
                      {getStatusBadge(job.status)}
                    </div>

                    {job.error && (
                      <p className="mt-2 text-xs text-destructive">
                        {job.error}
                      </p>
                    )}

                    {job.status === 'failed' && (
                      <div className="mt-2 flex gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 text-xs flex-1"
                          onClick={() => printQueue.retryJob(job.id)}
                        >
                          <RefreshCw className="w-3 h-3 mr-1" />
                          Retry
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 text-xs"
                          onClick={() => printQueue.cancelJob(job.id)}
                        >
                          <X className="w-3 h-3" />
                        </Button>
                      </div>
                    )}

                    <p className="mt-1 text-xs text-muted-foreground">
                      {job.createdAt.toLocaleTimeString()}
                      {job.retryCount > 0 && ` • ${job.retryCount} retries`}
                    </p>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
