/**
 * ESC/POS Printer Service
 * Supports USB and Network thermal printers
 */

export interface PrinterConfig {
  id: string;
  name: string;
  type: 'thermal' | 'receipt' | 'kitchen';
  connectionType: 'usb' | 'network';
  ipAddress?: string;
  port?: number;
  isActive: boolean;
  isDefault: boolean;
  categories?: string[];
  printFor?: ('kot' | 'bill' | 'report')[];
}

export interface PrintJob {
  id: string;
  printerId: string;
  type: 'kot' | 'bill' | 'report';
  content: PrintContent;
  status: 'pending' | 'printing' | 'completed' | 'failed';
  retryCount: number;
  createdAt: Date;
  error?: string;
}

export interface PrintContent {
  title?: string;
  header?: string[];
  items?: PrintItem[];
  footer?: string[];
  totals?: { label: string; value: string }[];
  qrCode?: string;
  barcode?: string;
}

export interface PrintItem {
  name: string;
  quantity: number;
  price?: number;
  notes?: string;
  variant?: string;
  course?: string;
}

// ESC/POS Command Constants
export const ESC_POS = {
  // Initialize
  INIT: '\x1B\x40',
  
  // Text formatting
  BOLD_ON: '\x1B\x45\x01',
  BOLD_OFF: '\x1B\x45\x00',
  DOUBLE_HEIGHT_ON: '\x1B\x21\x10',
  DOUBLE_WIDTH_ON: '\x1B\x21\x20',
  DOUBLE_SIZE_ON: '\x1B\x21\x30',
  NORMAL_SIZE: '\x1B\x21\x00',
  UNDERLINE_ON: '\x1B\x2D\x01',
  UNDERLINE_OFF: '\x1B\x2D\x00',
  
  // Alignment
  ALIGN_LEFT: '\x1B\x61\x00',
  ALIGN_CENTER: '\x1B\x61\x01',
  ALIGN_RIGHT: '\x1B\x61\x02',
  
  // Feed and cut
  LINE_FEED: '\x0A',
  CARRIAGE_RETURN: '\x0D',
  CUT_PAPER: '\x1D\x56\x00',
  PARTIAL_CUT: '\x1D\x56\x01',
  FEED_AND_CUT: '\x1D\x56\x41\x03',
  
  // Cash drawer
  OPEN_DRAWER: '\x1B\x70\x00\x19\xFA',
  
  // Barcode
  BARCODE_HEIGHT: '\x1D\x68\x50',
  BARCODE_WIDTH: '\x1D\x77\x02',
  BARCODE_POSITION: '\x1D\x48\x02',
  
  // QR Code
  QR_MODEL: '\x1D\x28\x6B\x04\x00\x31\x41\x32\x00',
  QR_SIZE: '\x1D\x28\x6B\x03\x00\x31\x43\x06',
};

// Print queue for offline support
class PrintQueue {
  private queue: PrintJob[] = [];
  private isProcessing = false;
  private listeners: ((jobs: PrintJob[]) => void)[] = [];

  addJob(job: Omit<PrintJob, 'id' | 'status' | 'retryCount' | 'createdAt'>): string {
    const newJob: PrintJob = {
      ...job,
      id: `PJ-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      status: 'pending',
      retryCount: 0,
      createdAt: new Date(),
    };
    this.queue.push(newJob);
    this.notifyListeners();
    this.processQueue();
    return newJob.id;
  }

  getQueue(): PrintJob[] {
    return [...this.queue];
  }

  getPendingJobs(): PrintJob[] {
    return this.queue.filter(j => j.status === 'pending' || j.status === 'failed');
  }

  subscribe(listener: (jobs: PrintJob[]) => void): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter(l => l !== listener);
    };
  }

  private notifyListeners() {
    this.listeners.forEach(l => l(this.getQueue()));
  }

  private async processQueue() {
    if (this.isProcessing) return;
    this.isProcessing = true;

    while (this.queue.some(j => j.status === 'pending')) {
      const job = this.queue.find(j => j.status === 'pending');
      if (!job) break;

      job.status = 'printing';
      this.notifyListeners();

      try {
        await this.executeJob(job);
        job.status = 'completed';
        // Remove completed jobs after 5 minutes
        setTimeout(() => {
          this.queue = this.queue.filter(j => j.id !== job.id);
          this.notifyListeners();
        }, 5 * 60 * 1000);
      } catch (error) {
        job.retryCount++;
        job.error = error instanceof Error ? error.message : 'Unknown error';
        
        if (job.retryCount >= 3) {
          job.status = 'failed';
        } else {
          job.status = 'pending';
          // Wait before retry
          await new Promise(r => setTimeout(r, 2000));
        }
      }
      this.notifyListeners();
    }

    this.isProcessing = false;
  }

  private async executeJob(job: PrintJob): Promise<void> {
    // Generate ESC/POS commands
    const commands = this.generateCommands(job);
    
    // Try to send to printer
    await this.sendToPrinter(job.printerId, commands);
  }

  private generateCommands(job: PrintJob): string {
    const { content, type } = job;
    let commands = ESC_POS.INIT;

    // Header
    commands += ESC_POS.ALIGN_CENTER;
    commands += ESC_POS.DOUBLE_SIZE_ON;
    commands += content.title || (type === 'kot' ? 'KITCHEN ORDER' : 'BILL');
    commands += ESC_POS.LINE_FEED;
    commands += ESC_POS.NORMAL_SIZE;
    commands += ESC_POS.LINE_FEED;

    // Header lines
    if (content.header) {
      content.header.forEach(line => {
        commands += line + ESC_POS.LINE_FEED;
      });
      commands += ESC_POS.LINE_FEED;
    }

    // Items
    commands += ESC_POS.ALIGN_LEFT;
    commands += '--------------------------------' + ESC_POS.LINE_FEED;
    
    if (content.items) {
      content.items.forEach(item => {
        // Course header if present
        if (item.course) {
          commands += ESC_POS.BOLD_ON;
          commands += `=== ${item.course.toUpperCase()} ===${ESC_POS.LINE_FEED}`;
          commands += ESC_POS.BOLD_OFF;
        }

        // Item line
        commands += ESC_POS.BOLD_ON;
        commands += `${item.quantity}x ${item.name}`;
        commands += ESC_POS.BOLD_OFF;
        
        if (item.price !== undefined) {
          const priceStr = `₹${item.price.toFixed(0)}`;
          const padding = 32 - item.name.length - String(item.quantity).length - priceStr.length - 3;
          commands += ' '.repeat(Math.max(1, padding)) + priceStr;
        }
        commands += ESC_POS.LINE_FEED;

        // Variant
        if (item.variant) {
          commands += `  → ${item.variant}${ESC_POS.LINE_FEED}`;
        }

        // Notes
        if (item.notes) {
          commands += `  * ${item.notes}${ESC_POS.LINE_FEED}`;
        }
      });
    }

    commands += '--------------------------------' + ESC_POS.LINE_FEED;

    // Totals
    if (content.totals) {
      commands += ESC_POS.LINE_FEED;
      content.totals.forEach((total, i) => {
        if (i === content.totals!.length - 1) {
          commands += ESC_POS.BOLD_ON;
          commands += ESC_POS.DOUBLE_HEIGHT_ON;
        }
        const padding = 32 - total.label.length - total.value.length;
        commands += total.label + ' '.repeat(Math.max(1, padding)) + total.value;
        commands += ESC_POS.LINE_FEED;
        if (i === content.totals!.length - 1) {
          commands += ESC_POS.NORMAL_SIZE;
          commands += ESC_POS.BOLD_OFF;
        }
      });
    }

    // Footer
    if (content.footer) {
      commands += ESC_POS.LINE_FEED;
      commands += ESC_POS.ALIGN_CENTER;
      content.footer.forEach(line => {
        commands += line + ESC_POS.LINE_FEED;
      });
    }

    // Feed and cut
    commands += ESC_POS.LINE_FEED;
    commands += ESC_POS.LINE_FEED;
    commands += ESC_POS.LINE_FEED;
    commands += ESC_POS.FEED_AND_CUT;

    return commands;
  }

  private async sendToPrinter(printerId: string, commands: string): Promise<void> {
    // In a real implementation, this would:
    // 1. For USB: Use WebUSB API or a local print server
    // 2. For Network: Send raw TCP to printer IP:port
    
    // For now, we'll simulate printing and log to console
    console.log(`[PRINTER ${printerId}] Sending ${commands.length} bytes`);
    
    // Simulate network delay
    await new Promise(r => setTimeout(r, 500));
    
    // Store print log in database (handled by the backend print queue)
    console.log('[PRINTER] Print job completed');
  }

  retryJob(jobId: string) {
    const job = this.queue.find(j => j.id === jobId);
    if (job && job.status === 'failed') {
      job.status = 'pending';
      job.retryCount = 0;
      job.error = undefined;
      this.notifyListeners();
      this.processQueue();
    }
  }

  cancelJob(jobId: string) {
    this.queue = this.queue.filter(j => j.id !== jobId);
    this.notifyListeners();
  }
}

// Singleton instance
export const printQueue = new PrintQueue();

// Helper functions to generate print content
export function generateKOTContent(
  orderNumber: string,
  tableNumber: string | null,
  waiterName: string | null,
  items: PrintItem[],
  isReprint = false
): PrintContent {
  return {
    title: isReprint ? '*** REPRINT KOT ***' : 'KITCHEN ORDER',
    header: [
      `Order: ${orderNumber}`,
      `Table: ${tableNumber || 'Takeaway'}`,
      waiterName ? `Waiter: ${waiterName}` : '',
      `Time: ${new Date().toLocaleTimeString()}`,
    ].filter(Boolean),
    items,
    footer: [
      isReprint ? '*** REPRINT ***' : '',
      new Date().toLocaleDateString(),
    ].filter(Boolean),
  };
}

export function generateBillContent(
  billNumber: string,
  orderNumber: string,
  tableNumber: string | null,
  items: PrintItem[],
  subtotal: number,
  tax: number,
  serviceCharge: number,
  discount: number,
  total: number,
  restaurantName = 'Restaurant',
  paymentMethod?: string
): PrintContent {
  const totals = [
    { label: 'Subtotal', value: `₹${subtotal.toFixed(0)}` },
  ];

  if (tax > 0) {
    totals.push({ label: 'Tax', value: `₹${tax.toFixed(0)}` });
  }
  if (serviceCharge > 0) {
    totals.push({ label: 'Service Charge', value: `₹${serviceCharge.toFixed(0)}` });
  }
  if (discount > 0) {
    totals.push({ label: 'Discount', value: `-₹${discount.toFixed(0)}` });
  }
  totals.push({ label: 'TOTAL', value: `₹${total.toFixed(0)}` });

  return {
    title: restaurantName,
    header: [
      `Bill: ${billNumber}`,
      `Order: ${orderNumber}`,
      `Table: ${tableNumber || 'Takeaway'}`,
      `Date: ${new Date().toLocaleDateString()}`,
      `Time: ${new Date().toLocaleTimeString()}`,
    ],
    items,
    totals,
    footer: [
      paymentMethod ? `Paid by: ${paymentMethod.toUpperCase()}` : '',
      '',
      'Thank you for dining with us!',
      'Please visit again',
    ].filter(Boolean),
  };
}

// Export print functions
export async function printKOT(
  printerId: string,
  orderNumber: string,
  tableNumber: string | null,
  waiterName: string | null,
  items: PrintItem[],
  isReprint = false
): Promise<string> {
  const content = generateKOTContent(orderNumber, tableNumber, waiterName, items, isReprint);
  return printQueue.addJob({
    printerId,
    type: 'kot',
    content,
  });
}

export async function printBill(
  printerId: string,
  billNumber: string,
  orderNumber: string,
  tableNumber: string | null,
  items: PrintItem[],
  subtotal: number,
  tax: number,
  serviceCharge: number,
  discount: number,
  total: number,
  restaurantName?: string,
  paymentMethod?: string
): Promise<string> {
  const content = generateBillContent(
    billNumber,
    orderNumber,
    tableNumber,
    items,
    subtotal,
    tax,
    serviceCharge,
    discount,
    total,
    restaurantName,
    paymentMethod
  );
  return printQueue.addJob({
    printerId,
    type: 'bill',
    content,
  });
}

export async function openCashDrawer(printerId: string): Promise<void> {
  // Send cash drawer open command
  console.log(`[PRINTER ${printerId}] Opening cash drawer`);
}
