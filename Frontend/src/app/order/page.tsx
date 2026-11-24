import { Suspense } from 'react';
import CustomerOrder from '@/views/CustomerOrder';

export default function Page() {
  return (
    <Suspense fallback={null}>
      <CustomerOrder />
    </Suspense>
  );
}
