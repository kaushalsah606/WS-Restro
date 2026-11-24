'use client';

import { ReactNode } from 'react';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';

type AppRole = 'SUPER_ADMIN' | 'RESTAURANT_ADMIN' | 'BRANCH_MANAGER' | 'CASHIER' | 'WAITER' | 'KITCHEN_STAFF' | 'CUSTOMER';

interface ProtectedRouteProps {
  children: ReactNode;
  allowedRoles?: AppRole[];
  requireAuth?: boolean;
}

export function ProtectedRoute({ 
  children, 
  allowedRoles,
  requireAuth = true 
}: ProtectedRouteProps) {
  const { user, loading, hasRole, roles } = useAuth();
  const router = useRouter();

  const needsLogin = !loading && requireAuth && !user;
  const notAllowed =
    !loading && !needsLogin && !!allowedRoles && allowedRoles.length > 0 &&
    roles.length > 0 && !allowedRoles.some(role => hasRole(role));

  useEffect(() => {
    if (needsLogin) router.replace('/auth');
    else if (notAllowed) router.replace('/unauthorized');
  }, [needsLogin, notAllowed, router]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center">
          <Loader2 className="w-8 h-8 animate-spin text-primary mx-auto mb-4" />
          <p className="text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  if (needsLogin || notAllowed) return null;

  return <>{children}</>;
}
