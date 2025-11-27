'use client';

import { use, useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function AdminIndexPage({ params }: { params: Promise<{ indexId: string }> }) {
  const { indexId } = use(params);
  const router = useRouter();

  useEffect(() => {
    // Redirect to approvals page by default
    router.replace(`/admin/${indexId}/settings`);
  }, [indexId, router]);

  return null;
}
