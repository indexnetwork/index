'use client';

import { PropsWithChildren } from 'react';

export default function ClientLayout({ children }: PropsWithChildren) {
  // Note: Header is now handled at the root level in ClientWrapper
  // This component now only provides content wrapper functionality
  return (
    <>
      {children}
    </>
  );
} 