'use client';

import { PropsWithChildren } from 'react';
import { ThemeProvider } from '@/contexts/ThemeContext';
import ClientLayout from '@/components/ClientLayout';
import { PrivyProvider } from '@/components/PrivyProvider';
import { AuthProvider } from '@/contexts/AuthContext';

export default function RootLayoutClient({ children }: PropsWithChildren) {
  return (
    <PrivyProvider>
      <AuthProvider>
        <ThemeProvider>
          <ClientLayout>{children}</ClientLayout>
        </ThemeProvider>
      </AuthProvider>
    </PrivyProvider>
  );
} 