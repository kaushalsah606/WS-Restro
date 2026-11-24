'use client';

import { useState, useEffect } from 'react';
import { 
  Users, 
  Plus, 
  Edit2, 
  Trash2, 
  Shield, 
  Loader2,
  Mail,
  Phone,
  UserPlus
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { 
  Dialog, 
  DialogContent, 
  DialogHeader, 
  DialogTitle, 
  DialogTrigger,
  DialogFooter 
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { apiClient, errorMessage } from '@/lib/api-client';
import { toast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';

type AppRole = 'super_admin' | 'restaurant_admin' | 'branch_manager' | 'cashier' | 'waiter' | 'kitchen_staff';

interface StaffMember {
  id: string;
  email: string | null;
  full_name: string | null;
  phone: string | null;
  is_active: boolean;
  created_at: string;
  roles: { id: string; role: AppRole; branch_id: string | null }[];
}

const roleLabels: Record<AppRole, string> = {
  super_admin: 'Super Admin',
  restaurant_admin: 'Restaurant Admin',
  branch_manager: 'Manager',
  cashier: 'Cashier',
  waiter: 'Waiter',
  kitchen_staff: 'Kitchen Staff',
};

const roleColors: Record<AppRole, string> = {
  super_admin: 'bg-destructive/10 text-destructive border-destructive/30',
  restaurant_admin: 'bg-purple-500/10 text-purple-600 border-purple-500/30',
  branch_manager: 'bg-amber-500/10 text-amber-600 border-amber-500/30',
  cashier: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/30',
  waiter: 'bg-blue-500/10 text-blue-600 border-blue-500/30',
  kitchen_staff: 'bg-orange-500/10 text-orange-600 border-orange-500/30',
};

export function StaffManagement() {
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [isRoleDialogOpen, setIsRoleDialogOpen] = useState(false);
  const [selectedStaff, setSelectedStaff] = useState<StaffMember | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [newRole, setNewRole] = useState<AppRole>('waiter');
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    fetchStaff();
  }, []);

  const fetchStaff = async () => {
    try {
      // users come back with their roles attached
      const users = await apiClient.snake.get<any[]>('/auth/users', { limit: 500 });
      const staffWithRoles: StaffMember[] = (users || []).map((u) => ({
        ...u,
        roles: (u.roles || []).map((r: any) => ({ id: r.id, role: String(r.role).toLowerCase() as AppRole, branch_id: r.branch_id })),
      }));

      setStaff(staffWithRoles);
    } catch (error) {
      console.error('Error fetching staff:', error);
      toast({
        title: "Error",
        description: errorMessage(error, "Failed to load staff members"),
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleAddRole = async () => {
    if (!selectedStaff) return;
    
    setIsSubmitting(true);
    try {
      // branch comes from the signed-in manager's own role; duplicates are rejected with 409
      await apiClient.snake.post(`/auth/users/${selectedStaff.id}/roles`, { role: newRole.toUpperCase() });
      toast({
        title: "Role assigned",
        description: `${roleLabels[newRole]} role has been assigned.`,
      });
      fetchStaff();
      setIsRoleDialogOpen(false);
    } catch (error) {
      console.error('Error adding role:', error);
      toast({
        title: "Error",
        description: errorMessage(error, "Failed to assign role"),
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRemoveRole = async (roleId: string) => {
    try {
      const owner = staff.find((s) => s.roles.some((r) => r.id === roleId));
      if (!owner) return;
      await apiClient.snake.delete(`/auth/users/${owner.id}/roles/${roleId}`);

      toast({
        title: "Role removed",
        description: "The role has been removed from this user.",
      });
      fetchStaff();
    } catch (error) {
      console.error('Error removing role:', error);
      toast({
        title: "Error",
        description: errorMessage(error, "Failed to remove role"),
        variant: "destructive",
      });
    }
  };

  const handleDeleteStaff = async (userId: string) => {
    try {
      // server removes roles, deactivates the account and revokes its sessions
      await apiClient.snake.delete(`/auth/users/${userId}`);

      toast({
        title: "Staff deactivated",
        description: "The staff member has been deactivated.",
      });
      fetchStaff();
    } catch (error) {
      console.error('Error deleting staff:', error);
      toast({
        title: "Error",
        description: errorMessage(error, "Failed to deactivate staff member"),
        variant: "destructive",
      });
    } finally {
      setDeleteConfirmId(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-foreground">Staff Management</h2>
          <p className="text-muted-foreground">Manage employees and their roles</p>
        </div>
        <div className="flex gap-2">
          <Badge variant="outline" className="text-sm">
            {staff.filter(s => s.is_active).length} Active Staff
          </Badge>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
        {(Object.keys(roleLabels) as AppRole[]).map(role => (
          <Card key={role} className="border-none shadow-sm">
            <CardContent className="pt-4">
              <div className="flex items-center gap-2">
                <Shield className={cn("w-4 h-4", roleColors[role].split(' ')[1])} />
                <span className="text-sm text-muted-foreground">{roleLabels[role]}s</span>
              </div>
              <p className="text-2xl font-bold mt-1">
                {staff.filter(s => s.roles.some(r => r.role === role)).length}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Staff Table */}
      <Card className="border-none shadow-md">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="w-5 h-5" />
            All Staff Members
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Phone</TableHead>
                <TableHead>Roles</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {staff.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                    No staff members found. Create accounts via the sign-up page.
                  </TableCell>
                </TableRow>
              ) : (
                staff.map((member) => (
                  <TableRow key={member.id}>
                    <TableCell className="font-medium">
                      {member.full_name || 'Unnamed'}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2 text-muted-foreground">
                        <Mail className="w-4 h-4" />
                        {member.email}
                      </div>
                    </TableCell>
                    <TableCell>
                      {member.phone ? (
                        <div className="flex items-center gap-2 text-muted-foreground">
                          <Phone className="w-4 h-4" />
                          {member.phone}
                        </div>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {member.roles.length === 0 ? (
                          <Badge variant="outline" className="text-muted-foreground">
                            No roles
                          </Badge>
                        ) : (
                          member.roles.map((role) => (
                            <Badge 
                              key={role.id} 
                              variant="outline"
                              className={cn("cursor-pointer", roleColors[role.role])}
                              onClick={() => handleRemoveRole(role.id)}
                              title="Click to remove"
                            >
                              {roleLabels[role.role]}
                            </Badge>
                          ))
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant={member.is_active ? "default" : "secondary"}>
                        {member.is_active ? 'Active' : 'Inactive'}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-2">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => {
                            setSelectedStaff(member);
                            setIsRoleDialogOpen(true);
                          }}
                          title="Add role"
                        >
                          <UserPlus className="w-4 h-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="text-destructive hover:text-destructive"
                          onClick={() => setDeleteConfirmId(member.id)}
                          title="Deactivate"
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Add Role Dialog */}
      <Dialog open={isRoleDialogOpen} onOpenChange={setIsRoleDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Assign Role</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Staff Member</Label>
              <Input value={selectedStaff?.full_name || selectedStaff?.email || ''} disabled />
            </div>
            <div className="space-y-2">
              <Label>Role</Label>
              <Select value={newRole} onValueChange={(v) => setNewRole(v as AppRole)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(roleLabels) as AppRole[]).map((role) => (
                    <SelectItem key={role} value={role}>
                      {roleLabels[role]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsRoleDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleAddRole} disabled={isSubmitting}>
              {isSubmitting ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Assigning...
                </>
              ) : (
                'Assign Role'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog open={!!deleteConfirmId} onOpenChange={() => setDeleteConfirmId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Deactivate Staff Member?</AlertDialogTitle>
            <AlertDialogDescription>
              This will remove all roles and deactivate this staff member. They will no longer be able to access the system.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deleteConfirmId && handleDeleteStaff(deleteConfirmId)}
            >
              Deactivate
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}