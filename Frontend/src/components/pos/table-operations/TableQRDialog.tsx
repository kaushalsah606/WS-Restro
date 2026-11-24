'use client';

import { QRCodeSVG } from 'qrcode.react';
import { QrCode, Download, Printer, Copy, Check } from 'lucide-react';
import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import type { TableWithOrder } from '@/hooks/useDatabase';

interface TableQRDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  table: TableWithOrder | null;
  branchId: string;
}

export function TableQRDialog({
  open,
  onOpenChange,
  table,
  branchId,
}: TableQRDialogProps) {
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);

  // Generate the QR URL for customer ordering
  const orderUrl = `${window.location.origin}/order?branch=${branchId}&table=${table?.id}`;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(orderUrl);
      setCopied(true);
      toast({
        title: 'Copied!',
        description: 'QR link copied to clipboard',
      });
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast({
        title: 'Error',
        description: 'Failed to copy link',
        variant: 'destructive',
      });
    }
  };

  const handleDownload = () => {
    const svg = document.getElementById('table-qr-code');
    if (!svg) return;

    const svgData = new XMLSerializer().serializeToString(svg);
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const img = new Image();

    img.onload = () => {
      canvas.width = img.width;
      canvas.height = img.height;
      ctx?.drawImage(img, 0, 0);
      const pngFile = canvas.toDataURL('image/png');
      const downloadLink = document.createElement('a');
      downloadLink.download = `Table-${table?.table_number}-QR.png`;
      downloadLink.href = pngFile;
      downloadLink.click();
    };

    img.src = 'data:image/svg+xml;base64,' + btoa(svgData);
  };

  const handlePrint = () => {
    const printWindow = window.open('', '', 'width=400,height=500');
    if (!printWindow) return;

    const svg = document.getElementById('table-qr-code');
    if (!svg) return;

    const svgData = new XMLSerializer().serializeToString(svg);

    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>Table ${table?.table_number} QR Code</title>
          <style>
            body {
              display: flex;
              flex-direction: column;
              align-items: center;
              justify-content: center;
              min-height: 100vh;
              margin: 0;
              font-family: Arial, sans-serif;
            }
            h1 {
              font-size: 24px;
              margin-bottom: 16px;
            }
            p {
              font-size: 14px;
              color: #666;
              margin-top: 16px;
            }
          </style>
        </head>
        <body>
          <h1>Table ${table?.table_number}</h1>
          ${svgData}
          <p>Scan to order</p>
        </body>
      </html>
    `);

    printWindow.document.close();
    printWindow.focus();
    printWindow.print();
    printWindow.close();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <QrCode className="h-5 w-5 text-primary" />
            Table QR Code
          </DialogTitle>
          <DialogDescription>
            Customers can scan this QR code to order from Table{' '}
            {table?.table_number}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col items-center py-6">
          <div className="p-4 bg-white rounded-xl shadow-md">
            <QRCodeSVG
              id="table-qr-code"
              value={orderUrl}
              size={200}
              level="H"
              includeMargin={false}
            />
          </div>

          <div className="mt-4 text-center">
            <p className="text-2xl font-bold">Table {table?.table_number}</p>
            <p className="text-sm text-muted-foreground">
              {table?.capacity} seats • {table?.area || 'Main'}
            </p>
          </div>
        </div>

        <DialogFooter className="flex-col gap-2 sm:flex-row">
          <Button
            variant="outline"
            size="sm"
            className="w-full sm:w-auto"
            onClick={handleCopy}
          >
            {copied ? (
              <Check className="h-4 w-4 mr-2" />
            ) : (
              <Copy className="h-4 w-4 mr-2" />
            )}
            {copied ? 'Copied!' : 'Copy Link'}
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="w-full sm:w-auto"
            onClick={handleDownload}
          >
            <Download className="h-4 w-4 mr-2" />
            Download
          </Button>
          <Button
            size="sm"
            className="w-full sm:w-auto"
            onClick={handlePrint}
          >
            <Printer className="h-4 w-4 mr-2" />
            Print
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
