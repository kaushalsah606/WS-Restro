'use client';

import { forwardRef } from 'react';
import { format } from 'date-fns';

interface BillPrintProps {
  order: {
    order_number: string;
    table_number?: string;
    items: Array<{
      name: string;
      quantity: number;
      unit_price: number;
      total: number;
    }>;
    subtotal: number;
    tax: number;
    service_charge: number;
    discount: number;
    total: number;
  };
  billNumber: string;
  restaurantName?: string;
  restaurantAddress?: string;
  restaurantPhone?: string;
}

interface KOTPrintProps {
  order: {
    order_number: string;
    table_number?: string;
    waiter_name?: string;
    items: Array<{
      name: string;
      quantity: number;
      notes?: string;
      course?: string;
    }>;
  };
  kotNumber: string;
}

export const BillPrintTemplate = forwardRef<HTMLDivElement, BillPrintProps>(
  ({ order, billNumber, restaurantName = 'RestoPOS', restaurantAddress, restaurantPhone }, ref) => {
    return (
      <div ref={ref} className="print-template p-4 bg-white text-black font-mono text-sm max-w-[300px]">
        <style>{`
          @media print {
            .print-template {
              width: 80mm;
              padding: 4mm;
              font-size: 12px;
            }
            .no-print { display: none !important; }
          }
        `}</style>
        
        {/* Header */}
        <div className="text-center border-b border-dashed border-gray-400 pb-3 mb-3">
          <h1 className="text-lg font-bold">{restaurantName}</h1>
          {restaurantAddress && <p className="text-xs">{restaurantAddress}</p>}
          {restaurantPhone && <p className="text-xs">Tel: {restaurantPhone}</p>}
          <p className="text-xs mt-2">--------------------------------</p>
          <p className="font-bold">TAX INVOICE</p>
        </div>

        {/* Bill Info */}
        <div className="border-b border-dashed border-gray-400 pb-3 mb-3">
          <div className="flex justify-between text-xs">
            <span>Bill No:</span>
            <span className="font-bold">{billNumber}</span>
          </div>
          <div className="flex justify-between text-xs">
            <span>Order:</span>
            <span>{order.order_number}</span>
          </div>
          {order.table_number && (
            <div className="flex justify-between text-xs">
              <span>Table:</span>
              <span>{order.table_number}</span>
            </div>
          )}
          <div className="flex justify-between text-xs">
            <span>Date:</span>
            <span>{format(new Date(), 'dd/MM/yyyy HH:mm')}</span>
          </div>
        </div>

        {/* Items */}
        <div className="border-b border-dashed border-gray-400 pb-3 mb-3">
          <div className="flex justify-between text-xs font-bold mb-2">
            <span className="flex-1">Item</span>
            <span className="w-8 text-center">Qty</span>
            <span className="w-16 text-right">Amount</span>
          </div>
          {order.items.map((item, index) => (
            <div key={index} className="flex justify-between text-xs mb-1">
              <span className="flex-1 truncate">{item.name}</span>
              <span className="w-8 text-center">{item.quantity}</span>
              <span className="w-16 text-right">₹{item.total.toFixed(0)}</span>
            </div>
          ))}
        </div>

        {/* Totals */}
        <div className="border-b border-dashed border-gray-400 pb-3 mb-3">
          <div className="flex justify-between text-xs">
            <span>Subtotal:</span>
            <span>₹{order.subtotal.toFixed(0)}</span>
          </div>
          {order.tax > 0 && (
            <div className="flex justify-between text-xs">
              <span>GST (5%):</span>
              <span>₹{order.tax.toFixed(0)}</span>
            </div>
          )}
          {order.service_charge > 0 && (
            <div className="flex justify-between text-xs">
              <span>Service Charge:</span>
              <span>₹{order.service_charge.toFixed(0)}</span>
            </div>
          )}
          {order.discount > 0 && (
            <div className="flex justify-between text-xs">
              <span>Discount:</span>
              <span>-₹{order.discount.toFixed(0)}</span>
            </div>
          )}
          <div className="flex justify-between font-bold mt-2 text-base border-t border-gray-400 pt-2">
            <span>GRAND TOTAL:</span>
            <span>₹{order.total.toFixed(0)}</span>
          </div>
        </div>

        {/* Footer */}
        <div className="text-center text-xs">
          <p>Thank you for dining with us!</p>
          <p className="mt-2">--------------------------------</p>
          <p className="text-[10px] mt-1">Powered by RestoPOS</p>
        </div>
      </div>
    );
  }
);

BillPrintTemplate.displayName = 'BillPrintTemplate';

export const KOTPrintTemplate = forwardRef<HTMLDivElement, KOTPrintProps>(
  ({ order, kotNumber }, ref) => {
    // Group items by course
    const itemsByCourse = order.items.reduce((acc, item) => {
      const course = item.course || 'main';
      if (!acc[course]) acc[course] = [];
      acc[course].push(item);
      return acc;
    }, {} as Record<string, typeof order.items>);

    const courseOrder = ['starter', 'main', 'dessert'];
    const sortedCourses = Object.keys(itemsByCourse).sort(
      (a, b) => courseOrder.indexOf(a) - courseOrder.indexOf(b)
    );

    return (
      <div ref={ref} className="print-template p-4 bg-white text-black font-mono text-sm max-w-[300px]">
        <style>{`
          @media print {
            .print-template {
              width: 80mm;
              padding: 4mm;
              font-size: 14px;
            }
            .no-print { display: none !important; }
          }
        `}</style>
        
        {/* Header */}
        <div className="text-center border-b-2 border-black pb-2 mb-3">
          <h1 className="text-xl font-bold">*** KOT ***</h1>
          <p className="text-lg font-bold">Kitchen Order Ticket</p>
        </div>

        {/* Order Info */}
        <div className="border-b-2 border-black pb-2 mb-3">
          <div className="flex justify-between font-bold text-base">
            <span>KOT #:</span>
            <span>{kotNumber}</span>
          </div>
          <div className="flex justify-between">
            <span>Order:</span>
            <span className="font-bold">{order.order_number}</span>
          </div>
          {order.table_number && (
            <div className="flex justify-between text-lg font-bold bg-black text-white px-2 py-1 mt-1">
              <span>TABLE:</span>
              <span>{order.table_number}</span>
            </div>
          )}
          <div className="flex justify-between text-xs mt-1">
            <span>Time:</span>
            <span>{format(new Date(), 'HH:mm:ss')}</span>
          </div>
          {order.waiter_name && (
            <div className="flex justify-between text-xs">
              <span>Waiter:</span>
              <span>{order.waiter_name}</span>
            </div>
          )}
        </div>

        {/* Items by Course */}
        {sortedCourses.map((course) => (
          <div key={course} className="mb-3">
            <div className="bg-gray-200 px-2 py-1 font-bold uppercase text-center mb-2">
              {course === 'starter' ? '🥗 STARTERS' : course === 'main' ? '🍽️ MAIN COURSE' : '🍰 DESSERTS'}
            </div>
            {itemsByCourse[course].map((item, index) => (
              <div key={index} className="mb-2 border-b border-dashed border-gray-300 pb-2">
                <div className="flex justify-between">
                  <span className="flex-1 font-bold text-base">{item.name}</span>
                  <span className="text-xl font-bold bg-black text-white px-2 rounded">×{item.quantity}</span>
                </div>
                {item.notes && (
                  <p className="text-xs italic mt-1 bg-yellow-100 px-2 py-1">
                    ⚠️ Note: {item.notes}
                  </p>
                )}
              </div>
            ))}
          </div>
        ))}

        {/* Footer */}
        <div className="text-center border-t-2 border-black pt-2 mt-2">
          <p className="text-xs">{format(new Date(), 'dd/MM/yyyy HH:mm:ss')}</p>
          <p className="font-bold mt-2">================================</p>
        </div>
      </div>
    );
  }
);

KOTPrintTemplate.displayName = 'KOTPrintTemplate';

// Print utility function
export const printElement = (elementId: string) => {
  const element = document.getElementById(elementId);
  if (!element) return;

  const printWindow = window.open('', '_blank');
  if (!printWindow) {
    alert('Please allow popups for printing');
    return;
  }

  printWindow.document.write(`
    <!DOCTYPE html>
    <html>
      <head>
        <title>Print</title>
        <style>
          body {
            font-family: 'Courier New', monospace;
            margin: 0;
            padding: 0;
          }
          @page {
            size: 80mm auto;
            margin: 0;
          }
        </style>
      </head>
      <body>
        ${element.innerHTML}
      </body>
    </html>
  `);
  
  printWindow.document.close();
  printWindow.focus();
  
  setTimeout(() => {
    printWindow.print();
    printWindow.close();
  }, 250);
};