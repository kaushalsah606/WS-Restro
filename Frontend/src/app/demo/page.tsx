import { Suspense } from 'react';
import Demo from '@/views/Demo';

export default function Page() {
  return (
    <Suspense fallback={null}>
      <Demo />
    </Suspense>
  );
}
