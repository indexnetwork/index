'use client';

import { PropsWithChildren } from 'react';

interface ClientLayoutProps extends PropsWithChildren {
  showNavigation?: boolean; // Keep for backward compatibility but will be ignored
}

export default function ClientLayout({ children, showNavigation = true }: ClientLayoutProps) {
  // Note: Header is now handled at the root level in ClientWrapper
  // This component now only provides content wrapper functionality
  return (
    <>
      {children}
    </>
  );
} 