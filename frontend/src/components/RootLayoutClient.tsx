'use client';

import { PropsWithChildren } from 'react';

export default function RootLayoutClient({ children }: PropsWithChildren) {
  return (
    <div>{children}</div>
  );
} 