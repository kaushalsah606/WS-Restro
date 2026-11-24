import { ProtectedRoute } from '@/components/auth/ProtectedRoute';
import Index from '@/views/Index';

export default function Page() {
  return (
    <ProtectedRoute>
      <Index />
    </ProtectedRoute>
  );
}
