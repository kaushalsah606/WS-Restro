'use client';

import { POSLayout } from '@/components/pos/POSLayout';
import { useSearchParams } from 'next/navigation';

export default function Demo() {
  const searchParams = useSearchParams();
  const view = searchParams.get('view') || 'tables';
  
  return <POSLayout demoMode={true} defaultView={view} />;
}
