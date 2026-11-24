'use client';

import { 
  LayoutDashboard, 
  UtensilsCrossed, 
  ClipboardList, 
  CreditCard,
  ChefHat,
  Users,
  Settings,
  LogOut,
  Building2,
  BarChart3,
  FileBarChart,
  Package,
  CalendarDays,
  Printer
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { cn } from '@/lib/utils';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';

interface SidebarProps {
  currentView: string;
  onViewChange: (view: string) => void;
  demoMode?: boolean;
}

// Super admin has access to ALL menu items
const menuItems = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, roles: ['SUPER_ADMIN', 'RESTAURANT_ADMIN', 'BRANCH_MANAGER', 'WAITER', 'CASHIER', 'KITCHEN_STAFF'] },
  { id: 'tables', label: 'Tables', icon: UtensilsCrossed, roles: ['SUPER_ADMIN', 'RESTAURANT_ADMIN', 'BRANCH_MANAGER', 'WAITER', 'CASHIER'] },
  { id: 'orders', label: 'Orders', icon: ClipboardList, roles: ['SUPER_ADMIN', 'RESTAURANT_ADMIN', 'BRANCH_MANAGER', 'WAITER', 'CASHIER'] },
  { id: 'kitchen', label: 'Kitchen', icon: ChefHat, roles: ['SUPER_ADMIN', 'RESTAURANT_ADMIN', 'KITCHEN_STAFF', 'BRANCH_MANAGER'] },
  { id: 'billing', label: 'Billing', icon: CreditCard, roles: ['SUPER_ADMIN', 'RESTAURANT_ADMIN', 'CASHIER', 'BRANCH_MANAGER'] },
  { id: 'reservations', label: 'Reservations', icon: CalendarDays, roles: ['SUPER_ADMIN', 'RESTAURANT_ADMIN', 'BRANCH_MANAGER', 'WAITER', 'CASHIER'] },
  { id: 'menu', label: 'Menu', icon: Building2, roles: ['SUPER_ADMIN', 'RESTAURANT_ADMIN', 'BRANCH_MANAGER'] },
  { id: 'inventory', label: 'Inventory', icon: Package, roles: ['SUPER_ADMIN', 'RESTAURANT_ADMIN', 'BRANCH_MANAGER', 'KITCHEN_STAFF'] },
  { id: 'reports', label: 'Reports', icon: BarChart3, roles: ['SUPER_ADMIN', 'RESTAURANT_ADMIN', 'BRANCH_MANAGER'] },
  { id: 'detailed-reports', label: 'Detailed Reports', icon: FileBarChart, roles: ['SUPER_ADMIN', 'RESTAURANT_ADMIN', 'BRANCH_MANAGER', 'CASHIER'] },
];

const bottomItems = [
  { id: 'printers', label: 'Printers', icon: Printer, roles: ['SUPER_ADMIN', 'RESTAURANT_ADMIN', 'BRANCH_MANAGER'] },
  { id: 'staff', label: 'Staff', icon: Users, roles: ['SUPER_ADMIN', 'RESTAURANT_ADMIN', 'BRANCH_MANAGER'] },
  { id: 'settings', label: 'Settings', icon: Settings, roles: ['SUPER_ADMIN'] },
];

// Items visible in demo mode (waiter view)
const demoMenuItems = ['tables', 'orders', 'kitchen', 'reservations'];

export function Sidebar({ currentView, onViewChange, demoMode = false }: SidebarProps) {
  const { user, getPrimaryRole, signOut, hasRole } = useAuth();
  const router = useRouter();
  const primaryRole = demoMode ? 'WAITER' : getPrimaryRole();

  const handleSignOut = async () => {
    await signOut();
    router.push('/auth');
  };

  // Filter menu items based on user role or demo mode
  const filteredMenuItems = demoMode 
    ? menuItems.filter(item => demoMenuItems.includes(item.id))
    : menuItems.filter(item => {
        if (!primaryRole) return true;
        return item.roles.some(role => hasRole(role as any));
      });

  const filteredBottomItems = demoMode 
    ? [] 
    : bottomItems.filter(item => {
        if (!primaryRole) return false;
        return item.roles.some(role => hasRole(role as any));
      });

  return (
    <aside className="fixed left-0 top-0 z-40 h-screen w-20 lg:w-64 bg-sidebar border-r border-sidebar-border flex flex-col">
      {/* Logo */}
      <div className="h-16 flex items-center justify-center lg:justify-start px-4 border-b border-sidebar-border">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl gradient-primary flex items-center justify-center">
            <UtensilsCrossed className="w-5 h-5 text-primary-foreground" />
          </div>
          <div className="hidden lg:block">
            <h1 className="font-bold text-sidebar-foreground text-lg tracking-tight">RestoPOS</h1>
            <p className="text-xs text-sidebar-foreground/60">
              {demoMode ? 'Demo Mode' : 'Restaurant System'}
            </p>
          </div>
        </div>
      </div>

      {/* Main Navigation */}
      <nav className="flex-1 py-4 px-2 lg:px-3 space-y-1 overflow-y-auto">
        {filteredMenuItems.map(item => (
          <button
            key={item.id}
            onClick={() => onViewChange(item.id)}
            className={cn(
              "w-full flex items-center gap-3 px-3 py-3 rounded-xl transition-all duration-200",
              "touch-target",
              currentView === item.id
                ? "bg-sidebar-primary text-sidebar-primary-foreground shadow-lg"
                : "text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent"
            )}
          >
            <item.icon className="w-5 h-5 shrink-0" />
            <span className="hidden lg:block font-medium">{item.label}</span>
          </button>
        ))}
      </nav>

      {/* Bottom Section */}
      <div className="py-4 px-2 lg:px-3 border-t border-sidebar-border space-y-1">
        {filteredBottomItems.map(item => (
          <button
            key={item.id}
            onClick={() => onViewChange(item.id)}
            className={cn(
              "w-full flex items-center gap-3 px-3 py-3 rounded-xl transition-all duration-200",
              "touch-target",
              currentView === item.id
                ? "bg-sidebar-primary text-sidebar-primary-foreground"
                : "text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent"
            )}
          >
            <item.icon className="w-5 h-5 shrink-0" />
            <span className="hidden lg:block font-medium">{item.label}</span>
          </button>
        ))}

        {/* User Profile or Demo Banner */}
        {demoMode ? (
          <div className="mt-4 p-3 rounded-xl bg-amber-500/10 border border-amber-500/20">
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-amber-500/20 flex items-center justify-center text-amber-600 font-bold">
                  D
                </div>
                <div className="hidden lg:block flex-1 min-w-0">
                  <p className="font-medium text-sidebar-foreground truncate text-sm">
                    Demo User
                  </p>
                  <p className="text-xs text-amber-600">
                    Waiter View
                  </p>
                </div>
              </div>
              <Link 
                href="/auth"
                className="hidden lg:block text-center text-xs py-2 px-3 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors font-medium"
              >
                Sign in for full access
              </Link>
            </div>
          </div>
        ) : (
          <div className="mt-4 p-3 rounded-xl bg-sidebar-accent">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-sidebar-primary flex items-center justify-center text-sidebar-primary-foreground font-bold">
                {user?.fullName?.charAt(0) || user?.email?.charAt(0) || 'U'}
              </div>
              <div className="hidden lg:block flex-1 min-w-0">
                <p className="font-medium text-sidebar-foreground truncate text-sm">
                  {user?.fullName || user?.email || 'User'}
                </p>
                <p className="text-xs text-sidebar-foreground/60 capitalize">
                  {primaryRole === 'BRANCH_MANAGER' ? 'Manager' : primaryRole?.replace('_', ' ') || 'No role'}
                </p>
              </div>
              <Button 
                variant="ghost" 
                size="icon"
                onClick={handleSignOut}
                className="hidden lg:flex p-2 rounded-lg hover:bg-sidebar-border/50 text-sidebar-foreground/60 hover:text-sidebar-foreground transition-colors"
              >
                <LogOut className="w-4 h-4" />
              </Button>
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}
