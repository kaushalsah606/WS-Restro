'use client';

import { useState, useEffect, createContext, useContext, ReactNode } from 'react';
import { useToast } from '@/hooks/use-toast';
import { apiClient } from '@/lib/api-client';
import { socketClient } from '@/lib/socket-client';

type AppRole = 'SUPER_ADMIN' | 'RESTAURANT_ADMIN' | 'BRANCH_MANAGER' | 'CASHIER' | 'WAITER' | 'KITCHEN_STAFF' | 'CUSTOMER';

interface UserRole {
  id: string;
  userId: string;
  role: AppRole;
  restaurantId: string | null;
  branchId: string | null;
}

interface User {
  id: string;
  email: string;
  fullName: string | null;
  phone: string | null;
  avatarUrl: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

interface AuthContextType {
  user: User | null;
  roles: UserRole[];
  loading: boolean;
  currentBranchId: string | null;
  currentRestaurantId: string | null;
  signIn: (email: string, password: string) => Promise<{ error: Error | null }>;
  signUp: (email: string, password: string, fullName?: string, role?: AppRole) => Promise<{ error: Error | null }>;
  signOut: () => Promise<void>;
  hasRole: (role: AppRole) => boolean;
  getPrimaryRole: () => AppRole | null;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [roles, setRoles] = useState<UserRole[]>([]);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();

  // Load user from localStorage and verify token on mount
  useEffect(() => {
    const initAuth = async () => {
      const token = localStorage.getItem('accessToken');
      if (token) {
        try {
          await fetchUserProfile();
        } catch (error) {
          console.error('Failed to load user:', error);
          localStorage.removeItem('accessToken');
          localStorage.removeItem('refreshToken');
          setUser(null);
          setRoles([]);
        }
      }
      setLoading(false);
    };

    initAuth();
  }, []);

  const fetchUserProfile = async () => {
    try {
      const response = await apiClient.auth.getProfile();
      setUser(response.user);
      setRoles(response.roles || []);
    } catch (error) {
      console.error('Error fetching user profile:', error);
      throw error;
    }
  };

  const signIn = async (email: string, password: string) => {
    try {
      const response = await apiClient.auth.login({
        email: email.trim(),
        password,
      });

      // Tokens are already stored by apiClient.auth.login
      // Just update the user state
      setUser(response.user);
      setRoles(response.roles || []);

      toast({
        title: "Welcome back!",
        description: "You have successfully signed in.",
      });

      return { error: null };
    } catch (error: any) {
      const message = error.response?.data?.message || error.message || 'Sign in failed';
      toast({
        title: "Sign in failed",
        description: message,
        variant: "destructive",
      });
      return { error: new Error(message) };
    }
  };

  const signUp = async (email: string, password: string, fullName?: string, role?: AppRole) => {
    try {
      await apiClient.auth.register({
        email: email.trim(),
        password,
        fullName: fullName || '',
        role: role || 'WAITER',
      });

      toast({
        title: "Account created!",
        description: "You can now sign in with your credentials.",
      });

      return { error: null };
    } catch (error: any) {
      let message = error.response?.data?.message || error.message || 'Sign up failed';
      
      if (message.includes('already exists') || message.includes('duplicate')) {
        message = 'This email is already registered. Please sign in instead.';
      }

      toast({
        title: "Sign up failed",
        description: message,
        variant: "destructive",
      });
      return { error: new Error(message) };
    }
  };

  const signOut = async () => {
    try {
      await apiClient.auth.logout();
    } catch (error) {
      console.error('Logout error:', error);
    } finally {
      // Clear local storage and state regardless of API call success
      localStorage.removeItem('accessToken');
      localStorage.removeItem('refreshToken');
      socketClient.disconnect(); // next login reconnects with the new user's token
      setUser(null);
      setRoles([]);

      toast({
        title: "Signed out",
        description: "You have been signed out successfully.",
      });
    }
  };

  const hasRole = (role: AppRole): boolean => {
    return roles.some(r => r.role === role);
  };

  const getPrimaryRole = (): AppRole | null => {
    if (roles.length === 0) return null;
    
    // Role priority: SUPER_ADMIN > RESTAURANT_ADMIN > BRANCH_MANAGER > CASHIER > WAITER > KITCHEN_STAFF > CUSTOMER
    const rolePriority: AppRole[] = [
      'SUPER_ADMIN',
      'RESTAURANT_ADMIN',
      'BRANCH_MANAGER',
      'CASHIER',
      'WAITER',
      'KITCHEN_STAFF',
      'CUSTOMER'
    ];

    for (const priorityRole of rolePriority) {
      if (roles.some(r => r.role === priorityRole)) {
        return priorityRole;
      }
    }

    return roles[0].role;
  };

  const refreshUser = async () => {
    await fetchUserProfile();
  };

  const currentBranchId = roles.length > 0 && roles[0].branchId
    ? roles[0].branchId
    : process.env.NEXT_PUBLIC_BRANCH_ID || null;

  const currentRestaurantId = roles.length > 0 && roles[0].restaurantId
    ? roles[0].restaurantId
    : null;

  const value: AuthContextType = {
    user,
    roles,
    loading,
    currentBranchId,
    currentRestaurantId,
    signIn,
    signUp,
    signOut,
    hasRole,
    getPrimaryRole,
    refreshUser,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
