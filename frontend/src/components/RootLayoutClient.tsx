'use client';

import { PropsWithChildren } from 'react';
import ClientLayout from '@/components/ClientLayout';
import { AuthProvider } from '@/contexts/AuthContext';
import { PrivyProvider } from '@privy-io/react-auth';
import { privy } from '@/lib/privy';

export default function RootLayoutClient({ children }: PropsWithChildren) {
  return (
    <PrivyProvider
      appId={process.env.NEXT_PUBLIC_PRIVY_APP_ID as string}
      clientId={process.env.NEXT_PUBLIC_PRIVY_CLIENT_ID as string}
      config={privy}
    >
      <AuthProvider>
        <ClientLayout>{children}</ClientLayout>
      </AuthProvider>
    </PrivyProvider>
  );
} 