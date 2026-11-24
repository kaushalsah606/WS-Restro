'use client';

import { useState, useEffect, useCallback } from 'react';
import { Sidebar } from './Sidebar';
import { Header } from './Header';
import { Dashboard } from './Dashboard';
import {
  AdminDashboard,
  ManagerDashboard,
  WaiterDashboard,
  CashierDashboard,
  KitchenDashboard
} from './dashboards';
import { FloorLayoutEditor } from './FloorLayoutEditor';
import { OrdersList } from './OrdersList';
import { KitchenDisplay } from './KitchenDisplay';
import { BillingView } from './BillingView';
import { MenuManagement } from './MenuManagement';
import { StaffManagement } from './StaffManagement';
import { ReportsAnalytics } from './ReportsAnalytics';
import { DetailedReports } from './DetailedReports';
import { InventoryManagement } from './InventoryManagement';
import { ReservationManagement } from './ReservationManagement';
import { TableView } from './TableView';
import { PrinterManagement } from './PrinterManagement';
import { useAuth } from '@/hooks/useAuth';
import { useBranchRealtime } from '@/hooks/useBranchRealtime';
import { useQueryClient } from '@tanstack/react-query';
import { usePOSStore } from '@/stores/posStore';

const viewConfig: Record<string, { title: string; subtitle?: string }> = {
  dashboard: { title: 'Dashboard', subtitle: 'Overview of today\'s operations' },
  tables: { title: 'Table Management', subtitle: 'Manage tables and orders' },
  orders: { title: 'Orders', subtitle: 'Track and manage orders' },
  kitchen: { title: 'Kitchen Display', subtitle: 'Real-time order updates' },
  billing: { title: 'Billing', subtitle: 'Process payments and bills' },
  menu: { title: 'Menu', subtitle: 'Manage menu items' },
  staff: { title: 'Staff Management', subtitle: 'Manage employees and roles' },
  reports: { title: 'Reports & Analytics', subtitle: 'Sales and performance insights' },
  'detailed-reports': { title: 'Detailed Reports', subtitle: 'Item, category & waiter breakdowns' },
  inventory: { title: 'Inventory', subtitle: 'Track stock levels' },
  reservations: { title: 'Reservations', subtitle: 'Manage table bookings' },
  printers: { title: 'Printer Management', subtitle: 'Configure printing devices' },
  settings: { title: 'Settings', subtitle: 'System configuration' },
};

interface POSLayoutProps {
  demoMode?: boolean;
  defaultView?: string;
}

export function POSLayout({ demoMode = false, defaultView }: POSLayoutProps) {
  const { getPrimaryRole, loading: authLoading } = useAuth();
  const queryClient = useQueryClient();
  const primaryRole = getPrimaryRole();

  const getDefaultView = useCallback(() => {
    if (defaultView) return defaultView;
    // Route to role-specific default views
    switch (primaryRole) {
      case 'SUPER_ADMIN':
        return 'dashboard'; // Admin Dashboard
      case 'RESTAURANT_ADMIN':
      case 'BRANCH_MANAGER':
        return 'dashboard'; // Manager Dashboard
      case 'KITCHEN_STAFF':
        return 'kitchen'; // Kitchen Dashboard (via kitchen view)
      case 'WAITER':
        return 'dashboard'; // Waiter Dashboard
      case 'CASHIER':
        return 'dashboard'; // Cashier Dashboard
      default:
        return 'dashboard';
    }
  }, [defaultView, primaryRole]);

  const [currentView, setCurrentView] = useState(getDefaultView);

  // Load menu/tables/orders for the order-taking screens once signed in
  const initStore = usePOSStore((s) => s.init);
  const { user } = useAuth();
  useEffect(() => {
    if (user) initStore();
  }, [user, initStore]);

  // Real-time data refresh callback
  const handleRealtimeUpdate = useCallback(() => {
    const s = usePOSStore.getState();
    s.refreshOrders();
    s.refreshTables();
    // Invalidate relevant queries to refresh data
    queryClient.invalidateQueries({ queryKey: ['orders'] });
    queryClient.invalidateQueries({ queryKey: ['tables'] });
    queryClient.invalidateQueries({ queryKey: ['bills'] });
    queryClient.invalidateQueries({ queryKey: ['reservations'] });
  }, [queryClient]);

  // Set up real-time subscriptions with sound alerts
  const { isConnected } = useBranchRealtime({
    onOrderUpdate: handleRealtimeUpdate,
    onTableUpdate: handleRealtimeUpdate,
    onKOTUpdate: handleRealtimeUpdate,
    onMenuUpdate: () => usePOSStore.getState().refreshMenu(),
    onBillUpdate: handleRealtimeUpdate,
    onReservationUpdate: handleRealtimeUpdate,
    showNotifications: true,
    enableSounds: true
  });

  // Update view when role changes (after login)
  useEffect(() => {
    if (!authLoading && primaryRole) {
      setCurrentView(getDefaultView());
    }
  }, [primaryRole, defaultView, authLoading, getDefaultView]);

  const renderView = () => {
    switch (currentView) {
      case 'dashboard':
        // Render role-specific dashboard
        switch (primaryRole) {
          case 'SUPER_ADMIN':
            return <AdminDashboard />;
          case 'RESTAURANT_ADMIN':
          case 'BRANCH_MANAGER':
            return <ManagerDashboard />;
          case 'WAITER':
            return <WaiterDashboard />;
          case 'CASHIER':
            return <CashierDashboard />;
          case 'KITCHEN_STAFF':
            return <KitchenDashboard />;
          default:
            return <Dashboard />;
        }
      case 'tables': return <TableView />;
      case 'orders': return <OrdersList />;
      case 'kitchen':
        // Kitchen staff sees their dashboard, others see the display
        return primaryRole === 'KITCHEN_STAFF' ? <KitchenDashboard /> : <KitchenDisplay />;
      case 'billing': return <BillingView />;
      case 'menu': return <MenuManagement />;
      case 'staff': return <StaffManagement />;
      case 'reports': return <ReportsAnalytics />;
      case 'detailed-reports': return <DetailedReports />;
      case 'inventory': return <InventoryManagement />;
      case 'reservations': return <ReservationManagement />;
      case 'printers': return <PrinterManagement />;
      default:
        return (
          <div className="flex items-center justify-center h-full text-muted-foreground">
            <p>This section is under development</p>
          </div>
        );
    }
  };

  const config = viewConfig[currentView] || { title: 'RestoPOS' };

  return (
    <div className="min-h-screen bg-background">
      <Sidebar
        currentView={currentView}
        onViewChange={setCurrentView}
        demoMode={demoMode}
      />

      <main className="pl-20 lg:pl-64 min-h-screen">
        <Header
          title={demoMode ? `${config.title} (Demo)` : config.title}
          subtitle={config.subtitle}
          isRealtimeConnected={isConnected}
        />
        <div className="min-h-[calc(100vh-4rem)]">
          {renderView()}
        </div>
      </main>
    </div>
  );
}
