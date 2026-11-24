'use client';

import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Volume2, VolumeX, Wifi, WifiOff } from 'lucide-react';
import { setMuted, getMuted, initializeAudio, playSound } from '@/utils/notificationSounds';
import { Badge } from '@/components/ui/badge';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';

interface NotificationControlProps {
  isConnected: boolean;
  className?: string;
}

export function NotificationControl({ isConnected, className = '' }: NotificationControlProps) {
  const [isMuted, setIsMutedState] = useState(getMuted());
  const [audioInitialized, setAudioInitialized] = useState(false);

  useEffect(() => {
    // Try to initialize audio on mount
    const init = async () => {
      const success = await initializeAudio();
      setAudioInitialized(success);
    };
    init();
  }, []);

  const toggleMute = async () => {
    if (!audioInitialized) {
      const success = await initializeAudio();
      setAudioInitialized(success);
    }

    const newMuted = !isMuted;
    setMuted(newMuted);
    setIsMutedState(newMuted);

    // Play a test sound when unmuting
    if (!newMuted) {
      await playSound('notification');
    }
  };

  return (
    <TooltipProvider>
      <div className={`flex items-center gap-2 ${className}`}>
        {/* Connection Status */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Badge 
              variant={isConnected ? "default" : "destructive"}
              className="flex items-center gap-1 cursor-default"
            >
              {isConnected ? (
                <Wifi className="h-3 w-3" />
              ) : (
                <WifiOff className="h-3 w-3" />
              )}
              <span className="text-xs">
                {isConnected ? 'Live' : 'Offline'}
              </span>
            </Badge>
          </TooltipTrigger>
          <TooltipContent>
            <p>{isConnected ? 'Real-time updates active' : 'Disconnected - reconnecting...'}</p>
          </TooltipContent>
        </Tooltip>

        {/* Sound Control */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              onClick={toggleMute}
              className="h-8 w-8 p-0"
            >
              {isMuted ? (
                <VolumeX className="h-4 w-4 text-muted-foreground" />
              ) : (
                <Volume2 className="h-4 w-4" />
              )}
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            <p>{isMuted ? 'Enable sound alerts' : 'Mute sound alerts'}</p>
          </TooltipContent>
        </Tooltip>
      </div>
    </TooltipProvider>
  );
}
