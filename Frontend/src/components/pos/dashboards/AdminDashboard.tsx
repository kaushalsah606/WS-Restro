'use client';

import { useState, useEffect } from 'react';
import { 
  TrendingUp, 
  Users,
  Store,
  ArrowUpRight,
  ShieldCheck,
  Activity,
  Globe,
  Loader2,
  Server,
  Database,
  CreditCard,
  Printer,
  AlertTriangle,
  CheckCircle,
  Plus,
  Eye,
  MoreHorizontal,
  RefreshCw,
  Settings,
  UtensilsCrossed
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { apiClient } from '@/lib/api-client';
import { useToast } from '@/hooks/use-toast';

export function AdminDashboard() {
  const [restaurants, setRestaurants] = useState<any[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [userRoles, setUserRoles] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('overview');
  const { toast } = useToast();

  // Get the single restaurant
  const restaurant = restaurants[0];

  const fetchData = async () => {
    try {
      // Fetch real restaurant data
      const [restaurantData, usersData] = await Promise.all([
        apiClient.restaurant.getAll(),
        apiClient.auth.getUsers().catch(() => []) // Fallback to empty array if fails
      ]);

      setRestaurants(restaurantData);
      setUsers(usersData);
      
      // Extract all user roles from users
      const allRoles = usersData.flatMap((user: any) => 
        (user.roles || []).map((role: any) => ({
          ...role,
          user_id: user.id,
        }))
      );
      setUserRoles(allRoles);
    } catch (error) {
      console.error('Error fetching admin data:', error);
      toast({
        title: "Error",
        description: "Failed to fetch admin data",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const activeUsers = users.filter(u => u.isActive).length;
  
  const getRoleCount = (role: string) => {
    return userRoles.filter(ur => ur.role === role).length;
  };

  const statCards = [
    {
      title: 'Restaurant',
      value: restaurant?.name || 'Loading...',
      subtitle: restaurant?.address || '',
      icon: Store,
      color: 'text-primary',
      bgColor: 'bg-primary/10',
    },
    {
      title: 'Staff Members',
      value: activeUsers.toString(),
      subtitle: `${users.length} total members`,
      icon: Users,
      color: 'text-accent',
      bgColor: 'bg-accent/10',
    },
    {
      title: 'Today\'s Orders',
      value: '0',
      change: 'Real-time tracking',
      icon: UtensilsCrossed,
      color: 'text-order-preparing',
      bgColor: 'bg-order-preparing/10',
    },
    {
      title: 'Today\'s Sales',
      value: '₹0',
      change: '+0% from yesterday',
      trend: 'up',
      icon: TrendingUp,
      color: 'text-status-available',
      bgColor: 'bg-status-available/10',
    },
  ];

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-primary/10">
            <ShieldCheck className="w-6 h-6 text-primary" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-foreground">Admin Dashboard</h2>
            <p className="text-sm text-muted-foreground">
              {restaurant?.name} - Complete restaurant management
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={fetchData}>
            <RefreshCw className="w-4 h-4 mr-2" />
            Refresh
          </Button>
          <Button variant="outline" size="sm">
            <Settings className="w-4 h-4 mr-2" />
            Settings
          </Button>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        {statCards.map((stat) => (
          <Card 
            key={stat.title} 
            className="relative overflow-hidden border-none shadow-md hover:shadow-lg transition-all hover:-translate-y-0.5"
          >
            <CardContent className="p-6">
              <div className="flex items-start justify-between">
                <div className="space-y-2">
                  <p className="text-sm font-medium text-muted-foreground">{stat.title}</p>
                  <p className="text-2xl font-bold text-foreground truncate max-w-[180px]">{stat.value}</p>
                  {stat.change && (
                    <div className="flex items-center gap-1">
                      {stat.trend === 'up' && <ArrowUpRight className="w-4 h-4 text-status-available" />}
                      <span className={cn(
                        "text-sm font-medium",
                        stat.trend === 'up' ? "text-status-available" : "text-muted-foreground"
                      )}>{stat.change}</span>
                    </div>
                  )}
                  {stat.subtitle && (
                    <p className="text-sm text-muted-foreground truncate max-w-[180px]">{stat.subtitle}</p>
                  )}
                </div>
                <div className={cn("p-3 rounded-xl flex-shrink-0", stat.bgColor)}>
                  <stat.icon className={cn("w-6 h-6", stat.color)} />
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Tabs Section */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <TabsList className="grid w-full max-w-sm grid-cols-2">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="staff">Staff</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-6">
          <div className="grid grid-cols-1 gap-6">
            {/* System stats - using real restaurant data */}
            <Card className="border-none shadow-md">
              <CardHeader className="pb-3">
                <CardTitle className="text-lg font-semibold flex items-center gap-2">
                  <Store className="w-5 h-5 text-primary" />
                  Restaurant Overview
                </CardTitle>
                <CardDescription>Current restaurant information</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  <div className="p-4 rounded-xl bg-primary/5 border border-primary/20">
                    <p className="text-sm text-muted-foreground mb-1">Restaurant Name</p>
                    <p className="font-semibold text-foreground">{restaurant?.name || 'N/A'}</p>
                  </div>
                  <div className="p-4 rounded-xl bg-primary/5 border border-primary/20">
                    <p className="text-sm text-muted-foreground mb-1">Total Branches</p>
                    <p className="font-semibold text-foreground">{restaurant?.branches?.length || 0}</p>
                  </div>
                  <div className="p-4 rounded-xl bg-primary/5 border border-primary/20">
                    <p className="text-sm text-muted-foreground mb-1">Active Users</p>
                    <p className="font-semibold text-foreground">{activeUsers}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="staff" className="space-y-4">
          <Card className="border-none shadow-md">
            <CardHeader className="pb-3">
              <CardTitle className="text-lg font-semibold flex items-center gap-2">
                <Users className="w-5 h-5 text-accent" />
                Staff Overview
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {[
                  { role: 'SUPER_ADMIN', label: 'Super Admins', color: 'bg-primary' },
                  { role: 'RESTAURANT_ADMIN', label: 'Managers', color: 'bg-accent' },
                  { role: 'CASHIER', label: 'Cashiers', color: 'bg-status-available' },
                  { role: 'WAITER', label: 'Waiters', color: 'bg-muted-foreground' },
                  { role: 'KITCHEN_STAFF', label: 'Kitchen Staff', color: 'bg-status-reserved' },
                ].map((item) => (
                  <div key={item.role} className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className={cn("w-3 h-3 rounded-full", item.color)} />
                      <span className="text-sm text-foreground">{item.label}</span>
                    </div>
                    <Badge variant="secondary">{getRoleCount(item.role)}</Badge>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="staff-list" className="space-y-4">
          <Card className="border-none shadow-md">
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>Staff Members</CardTitle>
                  <CardDescription>Manage your restaurant staff</CardDescription>
                </div>
                <Button size="sm">
                  <Plus className="w-4 h-4 mr-2" />
                  Add Staff
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {users.length === 0 ? (
                  <div className="text-center py-12 text-muted-foreground">
                    <Users className="w-12 h-12 mx-auto mb-3 opacity-50" />
                    <p>No staff members yet</p>
                  </div>
                ) : (
                  users.map((user) => {
                    const userRole = userRoles.find(r => r.user_id === user.id);
                    
                    return (
                      <div 
                        key={user.id}
                        className="flex items-center justify-between p-4 rounded-xl bg-muted/50 hover:bg-muted transition-colors"
                      >
                        <div className="flex items-center gap-4">
                          <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                            <span className="text-sm font-semibold text-primary">
                              {user.full_name?.charAt(0) || user.email?.charAt(0) || '?'}
                            </span>
                          </div>
                          <div>
                            <p className="font-medium text-foreground">{user.full_name || 'Unnamed'}</p>
                            <p className="text-sm text-muted-foreground">{user.email}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-3">
                          {userRole && (
                            <Badge variant="outline" className="capitalize">
                              {userRole.role === 'branch_manager' ? 'Manager' : userRole.role.replace('_', ' ')}
                            </Badge>
                          )}
                          <Badge variant={user.is_active ? "default" : "secondary"}>
                            {user.is_active ? 'Active' : 'Inactive'}
                          </Badge>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon">
                                <MoreHorizontal className="w-4 h-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem>
                                <Eye className="w-4 h-4 mr-2" />
                                View Profile
                              </DropdownMenuItem>
                              <DropdownMenuItem>Edit Role</DropdownMenuItem>
                              <DropdownMenuItem className="text-destructive">Deactivate</DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}