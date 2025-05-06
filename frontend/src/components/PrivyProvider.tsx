import { PrivyProvider as BasePrivyProvider } from '@privy-io/react-auth';
import { privy } from '@/lib/privy';
import { PropsWithChildren } from 'react';

export function PrivyProvider({ children }: PropsWithChildren) {
  return (
    <BasePrivyProvider
      appId={process.env.NEXT_PUBLIC_PRIVY_APP_ID as string}
      config={privy}
    >
      {children}
    </BasePrivyProvider>
  );
} 