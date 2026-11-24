'use client';

import { useState, useEffect } from 'react';
import { 
  CalendarDays, 
  Plus, 
  Clock, 
  Users, 
  Phone, 
  Mail,
  Check,
  X,
  UserCheck,
  AlertCircle,
  Loader2,
  ChevronLeft,
  ChevronRight
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Calendar } from '@/components/ui/calendar';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { apiClient, errorMessage } from '@/lib/api-client';
import { useSocketEvents } from '@/hooks/useRealtime';
import { socketClient } from '@/lib/socket-client';
import { toast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { format, addDays, isSameDay, parseISO, startOfDay } from 'date-fns';

interface Reservation {
  id: string;
  branch_id: string;
  table_id: string | null;
  customer_name: string;
  customer_phone: string;
  customer_email: string | null;
  party_size: number;
  reservation_date: string;
  reservation_time: string;
  duration_minutes: number;
  status: string;
  special_requests: string | null;
  created_at: string;
}

interface TableData {
  id: string;
  table_number: string;
  capacity: number;
  status: string;
}

const timeSlots = [
  '11:00', '11:30', '12:00', '12:30', '13:00', '13:30', '14:00', '14:30',
  '18:00', '18:30', '19:00', '19:30', '20:00', '20:30', '21:00', '21:30'
];

const statusConfig: Record<string, { label: string; color: string; icon: React.ElementType }> = {
  pending: { label: 'Pending', color: 'bg-amber-500/10 text-amber-600 border-amber-500/30', icon: Clock },
  confirmed: { label: 'Confirmed', color: 'bg-blue-500/10 text-blue-600 border-blue-500/30', icon: Check },
  seated: { label: 'Seated', color: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/30', icon: UserCheck },
  completed: { label: 'Completed', color: 'bg-muted text-muted-foreground border-muted', icon: Check },
  cancelled: { label: 'Cancelled', color: 'bg-destructive/10 text-destructive border-destructive/30', icon: X },
  no_show: { label: 'No Show', color: 'bg-destructive/10 text-destructive border-destructive/30', icon: AlertCircle },
};

export function ReservationManagement() {
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [tables, setTables] = useState<TableData[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [branchId, setBranchId] = useState<string | null>(null);

  // Form state
  const [formData, setFormData] = useState({
    customer_name: '',
    customer_phone: '',
    customer_email: '',
    party_size: 2,
    reservation_date: new Date(),
    reservation_time: '19:00',
    duration_minutes: 90,
    table_id: '',
    special_requests: ''
  });

  useEffect(() => {
    fetchData();

  }, []);

  // reservations created/changed from other terminals or by the no-show sweeper
  useSocketEvents(['reservation:created', 'reservation:updated'], () => fetchReservations());

  useEffect(() => {
    if (branchId) {
      fetchReservations();
    }
  }, [selectedDate, branchId]);

  const fetchData = async () => {
    try {
      const [branch, tablesData] = await Promise.all([
        apiClient.restaurant.getDefaultBranch(),
        apiClient.snake.get<TableData[]>('/tables'),
      ]);
      if (branch?.id) setBranchId(branch.id);
      setTables(tablesData || []);
    } catch (error) {
      console.error('Error fetching data:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchReservations = async () => {
    if (!branchId) return;

    try {
      const dateStr = format(selectedDate, 'yyyy-MM-dd');
      const data = await apiClient.snake.get<Reservation[]>('/reservations', { branch_id: branchId, date: dateStr });
      setReservations(data || []);
    } catch (error) {
      console.error('Error fetching reservations:', error);
    }
  };

  const handleAddReservation = async () => {
    if (!branchId) return;

    setIsSubmitting(true);
    try {
      await apiClient.snake.post('/reservations', {
        branch_id: branchId,
        customer_name: formData.customer_name,
        customer_phone: formData.customer_phone,
        customer_email: formData.customer_email || undefined,
        party_size: formData.party_size,
        reservation_date: format(formData.reservation_date, 'yyyy-MM-dd'),
        reservation_time: formData.reservation_time,
        duration_minutes: formData.duration_minutes,
        table_id: formData.table_id || undefined,
        special_requests: formData.special_requests || undefined,
        status: 'confirmed',
      });

      toast({
        title: "Reservation created",
        description: `Table booked for ${formData.customer_name}`,
      });

      setIsAddDialogOpen(false);
      resetForm();
      fetchReservations();
    } catch (error) {
      console.error('Error creating reservation:', error);
      toast({
        title: "Error",
        description: errorMessage(error, "Failed to create reservation"),
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleUpdateStatus = async (id: string, status: string) => {
    try {
      await apiClient.snake.patch(`/reservations/${id}/status`, { status });

      toast({
        title: "Status updated",
        description: `Reservation marked as ${status}`,
      });

      fetchReservations();
    } catch (error) {
      console.error('Error updating status:', error);
      toast({
        title: "Error",
        description: errorMessage(error, "Failed to update status"),
        variant: "destructive",
      });
    }
  };

  const resetForm = () => {
    setFormData({
      customer_name: '',
      customer_phone: '',
      customer_email: '',
      party_size: 2,
      reservation_date: new Date(),
      reservation_time: '19:00',
      duration_minutes: 90,
      table_id: '',
      special_requests: ''
    });
  };

  const getAvailableTables = () => {
    return tables.filter(t => t.capacity >= formData.party_size);
  };

  const navigateDate = (days: number) => {
    setSelectedDate(prev => addDays(prev, days));
  };

  // Group reservations by time slot
  const reservationsByTime = reservations.reduce((acc, res) => {
    const time = res.reservation_time.slice(0, 5);
    if (!acc[time]) acc[time] = [];
    acc[time].push(res);
    return acc;
  }, {} as Record<string, Reservation[]>);

  const todayStats = {
    total: reservations.length,
    confirmed: reservations.filter(r => r.status === 'confirmed').length,
    seated: reservations.filter(r => r.status === 'seated').length,
    pending: reservations.filter(r => r.status === 'pending').length,
    totalGuests: reservations.filter(r => ['confirmed', 'seated', 'pending'].includes(r.status))
      .reduce((sum, r) => sum + r.party_size, 0)
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
          <h2 className="text-2xl font-bold text-foreground">Reservations</h2>
          <p className="text-muted-foreground">Manage table bookings</p>
        </div>
        <Button onClick={() => setIsAddDialogOpen(true)}>
          <Plus className="w-4 h-4 mr-2" />
          New Reservation
        </Button>
      </div>

      {/* Date Navigation & Stats */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
        {/* Date Selector */}
        <Card className="border-none shadow-md lg:col-span-1">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between mb-4">
              <Button variant="ghost" size="icon" onClick={() => navigateDate(-1)}>
                <ChevronLeft className="w-4 h-4" />
              </Button>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" className="font-medium">
                    <CalendarDays className="w-4 h-4 mr-2" />
                    {format(selectedDate, 'EEE, MMM d')}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="center">
                  <Calendar
                    mode="single"
                    selected={selectedDate}
                    onSelect={(date) => date && setSelectedDate(date)}
                    initialFocus
                    className="p-3 pointer-events-auto"
                  />
                </PopoverContent>
              </Popover>
              <Button variant="ghost" size="icon" onClick={() => navigateDate(1)}>
                <ChevronRight className="w-4 h-4" />
              </Button>
            </div>
            <div className="flex gap-2 justify-center">
              <Button 
                variant={isSameDay(selectedDate, new Date()) ? 'default' : 'outline'} 
                size="sm"
                onClick={() => setSelectedDate(new Date())}
              >
                Today
              </Button>
              <Button 
                variant="outline" 
                size="sm"
                onClick={() => setSelectedDate(addDays(new Date(), 1))}
              >
                Tomorrow
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Stats */}
        <Card className="border-none shadow-md">
          <CardContent className="pt-6">
            <div className="flex items-center gap-2">
              <CalendarDays className="w-4 h-4 text-primary" />
              <span className="text-sm text-muted-foreground">Total Bookings</span>
            </div>
            <p className="text-2xl font-bold mt-1">{todayStats.total}</p>
          </CardContent>
        </Card>

        <Card className="border-none shadow-md">
          <CardContent className="pt-6">
            <div className="flex items-center gap-2">
              <Check className="w-4 h-4 text-blue-500" />
              <span className="text-sm text-muted-foreground">Confirmed</span>
            </div>
            <p className="text-2xl font-bold mt-1">{todayStats.confirmed}</p>
          </CardContent>
        </Card>

        <Card className="border-none shadow-md">
          <CardContent className="pt-6">
            <div className="flex items-center gap-2">
              <Users className="w-4 h-4 text-emerald-500" />
              <span className="text-sm text-muted-foreground">Expected Guests</span>
            </div>
            <p className="text-2xl font-bold mt-1">{todayStats.totalGuests}</p>
          </CardContent>
        </Card>
      </div>

      {/* Reservations Timeline */}
      <Card className="border-none shadow-md">
        <CardHeader>
          <CardTitle>Reservations for {format(selectedDate, 'EEEE, MMMM d, yyyy')}</CardTitle>
        </CardHeader>
        <CardContent>
          {reservations.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
              <CalendarDays className="w-12 h-12 mb-4 opacity-50" />
              <p className="text-lg font-medium">No reservations</p>
              <p className="text-sm">No bookings for this date</p>
            </div>
          ) : (
            <div className="space-y-4">
              {timeSlots.filter(time => reservationsByTime[time]).map(time => (
                <div key={time} className="border-l-2 border-primary/30 pl-4">
                  <div className="flex items-center gap-2 mb-2">
                    <Clock className="w-4 h-4 text-primary" />
                    <span className="font-semibold text-lg">{time}</span>
                    <Badge variant="outline">{reservationsByTime[time].length} booking(s)</Badge>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                    {reservationsByTime[time].map(reservation => {
                      const status = statusConfig[reservation.status];
                      const StatusIcon = status.icon;
                      const table = tables.find(t => t.id === reservation.table_id);
                      
                      return (
                        <Card key={reservation.id} className="border shadow-sm">
                          <CardContent className="p-4">
                            <div className="flex items-start justify-between mb-3">
                              <div>
                                <p className="font-semibold">{reservation.customer_name}</p>
                                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                                  <Users className="w-3 h-3" />
                                  <span>{reservation.party_size} guests</span>
                                  {table && (
                                    <>
                                      <span>•</span>
                                      <span>Table {table.table_number}</span>
                                    </>
                                  )}
                                </div>
                              </div>
                              <Badge variant="outline" className={status.color}>
                                <StatusIcon className="w-3 h-3 mr-1" />
                                {status.label}
                              </Badge>
                            </div>
                            
                            <div className="space-y-1 text-sm text-muted-foreground mb-3">
                              <div className="flex items-center gap-2">
                                <Phone className="w-3 h-3" />
                                <span>{reservation.customer_phone}</span>
                              </div>
                              {reservation.customer_email && (
                                <div className="flex items-center gap-2">
                                  <Mail className="w-3 h-3" />
                                  <span className="truncate">{reservation.customer_email}</span>
                                </div>
                              )}
                              {reservation.special_requests && (
                                <p className="text-xs italic bg-muted/50 p-2 rounded mt-2">
                                  "{reservation.special_requests}"
                                </p>
                              )}
                            </div>
                            
                            {/* Actions based on status */}
                            <div className="flex gap-2">
                              {reservation.status === 'pending' && (
                                <>
                                  <Button 
                                    size="sm" 
                                    variant="outline"
                                    className="flex-1"
                                    onClick={() => handleUpdateStatus(reservation.id, 'confirmed')}
                                  >
                                    <Check className="w-3 h-3 mr-1" />
                                    Confirm
                                  </Button>
                                  <Button 
                                    size="sm" 
                                    variant="outline"
                                    className="text-destructive"
                                    onClick={() => handleUpdateStatus(reservation.id, 'cancelled')}
                                  >
                                    <X className="w-3 h-3" />
                                  </Button>
                                </>
                              )}
                              {reservation.status === 'confirmed' && (
                                <>
                                  <Button 
                                    size="sm"
                                    className="flex-1"
                                    onClick={() => handleUpdateStatus(reservation.id, 'seated')}
                                  >
                                    <UserCheck className="w-3 h-3 mr-1" />
                                    Seat Guest
                                  </Button>
                                  <Button 
                                    size="sm" 
                                    variant="outline"
                                    className="text-destructive"
                                    onClick={() => handleUpdateStatus(reservation.id, 'no_show')}
                                  >
                                    No Show
                                  </Button>
                                </>
                              )}
                              {reservation.status === 'seated' && (
                                <Button 
                                  size="sm"
                                  variant="outline"
                                  className="flex-1"
                                  onClick={() => handleUpdateStatus(reservation.id, 'completed')}
                                >
                                  <Check className="w-3 h-3 mr-1" />
                                  Complete
                                </Button>
                              )}
                            </div>
                          </CardContent>
                        </Card>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Add Reservation Dialog */}
      <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>New Reservation</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Customer Name *</Label>
                <Input
                  value={formData.customer_name}
                  onChange={(e) => setFormData({ ...formData, customer_name: e.target.value })}
                  placeholder="John Smith"
                />
              </div>
              <div className="space-y-2">
                <Label>Phone *</Label>
                <Input
                  value={formData.customer_phone}
                  onChange={(e) => setFormData({ ...formData, customer_phone: e.target.value })}
                  placeholder="+91 98765 43210"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Email</Label>
              <Input
                type="email"
                value={formData.customer_email}
                onChange={(e) => setFormData({ ...formData, customer_email: e.target.value })}
                placeholder="john@example.com"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Date *</Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className="w-full justify-start">
                      <CalendarDays className="w-4 h-4 mr-2" />
                      {format(formData.reservation_date, 'MMM d, yyyy')}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar
                      mode="single"
                      selected={formData.reservation_date}
                      onSelect={(date) => date && setFormData({ ...formData, reservation_date: date })}
                      disabled={(date) => date < startOfDay(new Date())}
                      initialFocus
                      className="p-3 pointer-events-auto"
                    />
                  </PopoverContent>
                </Popover>
              </div>
              <div className="space-y-2">
                <Label>Time *</Label>
                <Select 
                  value={formData.reservation_time} 
                  onValueChange={(v) => setFormData({ ...formData, reservation_time: v })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {timeSlots.map(time => (
                      <SelectItem key={time} value={time}>{time}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Party Size *</Label>
                <Select 
                  value={formData.party_size.toString()} 
                  onValueChange={(v) => setFormData({ ...formData, party_size: Number(v) })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {[1, 2, 3, 4, 5, 6, 7, 8, 10, 12].map(n => (
                      <SelectItem key={n} value={n.toString()}>{n} {n === 1 ? 'guest' : 'guests'}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Assign Table</Label>
                <Select 
                  value={formData.table_id} 
                  onValueChange={(v) => setFormData({ ...formData, table_id: v })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Auto-assign" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="">Auto-assign</SelectItem>
                    {getAvailableTables().map(table => (
                      <SelectItem key={table.id} value={table.id}>
                        Table {table.table_number} ({table.capacity} seats)
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label>Special Requests</Label>
              <Textarea
                value={formData.special_requests}
                onChange={(e) => setFormData({ ...formData, special_requests: e.target.value })}
                placeholder="Window seat, birthday celebration, allergies..."
                rows={2}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsAddDialogOpen(false)}>Cancel</Button>
            <Button 
              onClick={handleAddReservation} 
              disabled={isSubmitting || !formData.customer_name || !formData.customer_phone}
            >
              {isSubmitting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
              Create Reservation
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}