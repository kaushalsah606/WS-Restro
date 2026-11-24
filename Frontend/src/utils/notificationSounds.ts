// Audio notification system for POS alerts
// Uses Web Audio API for cross-browser compatibility

type SoundType = 'newOrder' | 'orderReady' | 'urgent' | 'success' | 'error' | 'notification';

interface SoundConfig {
  frequency: number;
  duration: number;
  type: OscillatorType;
  volume: number;
  pattern?: number[]; // Array of durations for beep patterns
}

const soundConfigs: Record<SoundType, SoundConfig> = {
  newOrder: {
    frequency: 880, // A5 - bright, attention-grabbing
    duration: 150,
    type: 'sine',
    volume: 0.4,
    pattern: [150, 100, 150] // beep-pause-beep
  },
  orderReady: {
    frequency: 523.25, // C5 - pleasant notification
    duration: 200,
    type: 'sine',
    volume: 0.3,
    pattern: [200, 100, 200, 100, 200] // triple beep
  },
  urgent: {
    frequency: 1000, // High pitch for urgency
    duration: 100,
    type: 'square',
    volume: 0.5,
    pattern: [100, 50, 100, 50, 100, 50, 100] // rapid beeps
  },
  success: {
    frequency: 659.25, // E5 - pleasant success sound
    duration: 300,
    type: 'sine',
    volume: 0.25,
    pattern: [300]
  },
  error: {
    frequency: 220, // A3 - low error tone
    duration: 400,
    type: 'sawtooth',
    volume: 0.3,
    pattern: [200, 100, 400]
  },
  notification: {
    frequency: 440, // A4 - standard notification
    duration: 200,
    type: 'sine',
    volume: 0.2,
    pattern: [200]
  }
};

let audioContext: AudioContext | null = null;
let isMuted = false;

const getAudioContext = (): AudioContext => {
  if (!audioContext) {
    audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
  }
  return audioContext;
};

const playTone = (frequency: number, duration: number, type: OscillatorType, volume: number): Promise<void> => {
  return new Promise((resolve) => {
    const ctx = getAudioContext();
    const oscillator = ctx.createOscillator();
    const gainNode = ctx.createGain();

    oscillator.connect(gainNode);
    gainNode.connect(ctx.destination);

    oscillator.frequency.value = frequency;
    oscillator.type = type;
    
    // Fade in/out to prevent clicks
    gainNode.gain.setValueAtTime(0, ctx.currentTime);
    gainNode.gain.linearRampToValueAtTime(volume, ctx.currentTime + 0.01);
    gainNode.gain.linearRampToValueAtTime(0, ctx.currentTime + duration / 1000);

    oscillator.start(ctx.currentTime);
    oscillator.stop(ctx.currentTime + duration / 1000);

    oscillator.onended = () => resolve();
  });
};

export const playSound = async (soundType: SoundType): Promise<void> => {
  if (isMuted) return;

  const config = soundConfigs[soundType];
  if (!config) return;

  try {
    // Resume audio context if suspended (required by browsers)
    const ctx = getAudioContext();
    if (ctx.state === 'suspended') {
      await ctx.resume();
    }

    const { frequency, type, volume, pattern } = config;
    
    if (pattern && pattern.length > 1) {
      for (let i = 0; i < pattern.length; i++) {
        if (i % 2 === 0) {
          // Play tone
          await playTone(frequency, pattern[i], type, volume);
        } else {
          // Pause
          await new Promise(resolve => setTimeout(resolve, pattern[i]));
        }
      }
    } else {
      await playTone(frequency, config.duration, type, volume);
    }
  } catch (error) {
    console.warn('Failed to play notification sound:', error);
  }
};

export const setMuted = (muted: boolean): void => {
  isMuted = muted;
};

export const getMuted = (): boolean => isMuted;

export const initializeAudio = async (): Promise<boolean> => {
  try {
    const ctx = getAudioContext();
    if (ctx.state === 'suspended') {
      await ctx.resume();
    }
    return true;
  } catch (error) {
    console.warn('Failed to initialize audio:', error);
    return false;
  }
};

// Map order events to sound types
export const getOrderEventSound = (
  eventType: 'INSERT' | 'UPDATE' | 'DELETE',
  orderStatus?: string
): SoundType | null => {
  if (eventType === 'INSERT') {
    return 'newOrder';
  }
  
  if (eventType === 'UPDATE') {
    switch (orderStatus) {
      case 'ready':
        return 'orderReady';
      case 'cancelled':
        return 'error';
      case 'preparing':
        return 'notification';
      case 'served':
        return 'success';
      default:
        return 'notification';
    }
  }

  if (eventType === 'DELETE') {
    return 'error';
  }

  return null;
};

// Map KOT events to sound types
export const getKOTEventSound = (
  eventType: 'INSERT' | 'UPDATE' | 'DELETE'
): SoundType | null => {
  if (eventType === 'INSERT') {
    return 'urgent'; // Kitchen needs immediate attention
  }
  return 'notification';
};

// Map bill events to sound types
export const getBillEventSound = (
  eventType: 'INSERT' | 'UPDATE' | 'DELETE',
  paymentStatus?: string
): SoundType | null => {
  if (eventType === 'INSERT') {
    return 'notification';
  }
  
  if (eventType === 'UPDATE' && paymentStatus === 'completed') {
    return 'success';
  }

  return null;
};
