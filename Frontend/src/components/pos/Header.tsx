'use client';

import { Bell, Search, RefreshCw } from 'lucide-react';
import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NotificationControl } from './NotificationControl';

interface HeaderProps {
  title: string;
  subtitle?: string;
  isRealtimeConnected?: boolean;
}

export function Header({ title, subtitle, isRealtimeConnected = false }: HeaderProps) {
  const [currentTime, setCurrentTime] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  return (
    <header className="h-16 bg-card border-b border-border flex items-center justify-between px-6">
      <div>
        <h1 className="text-xl font-bold text-foreground">{title}</h1>
        {subtitle && (
          <p className="text-sm text-muted-foreground">{subtitle}</p>
        )}
      </div>

      <div className="flex items-center gap-4">
        {/* Search */}
        <div className="relative hidden md:block">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input 
            placeholder="Search orders, tables..."
            className="w-64 pl-10 bg-muted/50 border-none"
          />
        </div>

        {/* Time */}
        <div className="hidden lg:flex flex-col items-end">
          <span className="text-lg font-mono font-bold text-foreground">
            {currentTime.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
          </span>
          <span className="text-xs text-muted-foreground">
            {currentTime.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
          </span>
        </div>

        {/* Realtime & Sound Control */}
        <NotificationControl isConnected={isRealtimeConnected} />

        {/* Refresh */}
        <Button variant="ghost" size="icon" className="touch-target">
          <RefreshCw className="w-5 h-5" />
        </Button>

        {/* Notifications */}
        <Button variant="ghost" size="icon" className="touch-target relative">
          <Bell className="w-5 h-5" />
          <span className="absolute top-1 right-1 w-2 h-2 bg-destructive rounded-full" />
        </Button>
      </div>
    </header>
  );
}
