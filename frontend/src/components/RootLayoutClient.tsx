'use client';

import { PropsWithChildren } from 'react';
import { IntentProvider } from '@/contexts/IntentContext';
import { FileProvider } from '@/contexts/FileContext';
import { IntegrationProvider } from '@/contexts/IntegrationContext';
import { ThemeProvider } from '@/contexts/ThemeContext';
import ClientLayout from '@/components/ClientLayout';
import { PrivyProvider } from '@/components/PrivyProvider';

export default function RootLayoutClient({ children }: PropsWithChildren) {
  return (
    <PrivyProvider>
      <ThemeProvider>
        <IntentProvider>
          <FileProvider>
            <IntegrationProvider>
              <ClientLayout>{children}</ClientLayout>
            </IntegrationProvider>
          </FileProvider>
        </IntentProvider>
      </ThemeProvider>
    </PrivyProvider>
  );
} 