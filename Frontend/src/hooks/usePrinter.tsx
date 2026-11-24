'use client';

import { useState, useEffect, useCallback } from 'react';
import { apiClient } from '@/lib/api-client';
import { toast } from '@/hooks/use-toast';
import {
  printQueue,
  printKOT,
  printBill,
  openCashDrawer,
  type PrintJob,
  type PrintItem
} from '@/services/printerService';

interface Printer {
  id: string;
  name: string;
  type: string;
  connectionType: string;
  ipAddress: string | null;
  port: number | null;
  isActive: boolean;
  isDefault: boolean;
  categories: string[] | null;
  printFor: string[] | null;
  branchId: string;
}

export function usePrinters(branchId: string | null) {
  const [printers, setPrinters] = useState<Printer[]>([]);
  const [loading, setLoading] = useState(true);
  const [printJobs, setPrintJobs] = useState<PrintJob[]>([]);

  // Fetch printers
  useEffect(() => {
    if (!branchId) {
      setLoading(false);
      return;
    }

    const fetchPrinters = async () => {
      try {
        const res = await apiClient.get('/printers');
        setPrinters(res.data?.data ?? []);
      } catch (error) {
        console.error('Error fetching printers:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchPrinters();
  }, [branchId]);

  // Subscribe to print queue
  useEffect(() => {
    const unsubscribe = printQueue.subscribe(setPrintJobs);
    return unsubscribe;
  }, []);

  // Get printer for specific purpose
  const getPrinter = useCallback((purpose: 'kot' | 'bill' | 'report', categoryId?: string): Printer | null => {
    // First try to find printer configured for this purpose and category
    if (categoryId) {
      const categoryPrinter = printers.find(p =>
        p.printFor?.includes(purpose) &&
        p.categories?.includes(categoryId)
      );
      if (categoryPrinter) return categoryPrinter;
    }

    // Then find printer configured for this purpose
    const purposePrinter = printers.find(p => p.printFor?.includes(purpose));
    if (purposePrinter) return purposePrinter;

    // Fall back to default printer
    const defaultPrinter = printers.find(p => p.isDefault);
    if (defaultPrinter) return defaultPrinter;

    // Return first available printer
    return printers[0] || null;
  }, [printers]);

  // Print KOT
  const sendKOT = useCallback(async (
    orderNumber: string,
    tableNumber: string | null,
    waiterName: string | null,
    items: PrintItem[],
    isReprint = false
  ): Promise<boolean> => {
    const printer = getPrinter('kot');

    if (!printer) {
      toast({
        title: "No printer available",
        description: "Please configure a printer for KOT printing",
        variant: "destructive"
      });
      return false;
    }

    try {
      await printKOT(printer.id, orderNumber, tableNumber, waiterName, items, isReprint);

      // Note: Print logging is now handled by backend printer service

      toast({
        title: isReprint ? "KOT Reprinted" : "KOT Sent",
        description: `Sent to ${printer.name}`
      });
      return true;
    } catch (error) {
      console.error('Error printing KOT:', error);
      toast({
        title: "Print failed",
        description: "Failed to send KOT to printer",
        variant: "destructive"
      });
      return false;
    }
  }, [getPrinter, branchId]);

  // Print Bill
  const sendBill = useCallback(async (
    billNumber: string,
    orderNumber: string,
    tableNumber: string | null,
    items: PrintItem[],
    subtotal: number,
    tax: number,
    serviceCharge: number,
    discount: number,
    total: number,
    paymentMethod?: string
  ): Promise<boolean> => {
    const printer = getPrinter('bill');

    if (!printer) {
      toast({
        title: "No printer available",
        description: "Please configure a printer for bill printing",
        variant: "destructive"
      });
      return false;
    }

    try {
      await printBill(
        printer.id,
        billNumber,
        orderNumber,
        tableNumber,
        items,
        subtotal,
        tax,
        serviceCharge,
        discount,
        total,
        undefined,
        paymentMethod
      );

      // Print logging is now handled by backend printer service
      // No need to manually log to database here

      toast({
        title: "Bill Printed",
        description: `Sent to ${printer.name}`
      });
      return true;
    } catch (error) {
      console.error('Error printing bill:', error);
      toast({
        title: "Print failed",
        description: "Failed to send bill to printer",
        variant: "destructive"
      });
      return false;
    }
  }, [getPrinter, branchId]);

  // Open cash drawer
  const triggerCashDrawer = useCallback(async (): Promise<boolean> => {
    const printer = getPrinter('bill');

    if (!printer) {
      toast({
        title: "No printer available",
        description: "Cash drawer requires a connected printer",
        variant: "destructive"
      });
      return false;
    }

    try {
      await openCashDrawer(printer.id);
      return true;
    } catch (error) {
      console.error('Error opening cash drawer:', error);
      return false;
    }
  }, [getPrinter]);

  // Retry failed job
  const retryPrintJob = useCallback((jobId: string) => {
    printQueue.retryJob(jobId);
  }, []);

  // Cancel job
  const cancelPrintJob = useCallback((jobId: string) => {
    printQueue.cancelJob(jobId);
  }, []);

  return {
    printers,
    loading,
    printJobs,
    getPrinter,
    sendKOT,
    sendBill,
    triggerCashDrawer,
    retryPrintJob,
    cancelPrintJob,
  };
}
