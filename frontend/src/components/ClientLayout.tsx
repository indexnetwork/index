'use client';

import { PropsWithChildren } from 'react';
export default function ClientLayout({ children }: PropsWithChildren) {

  return (
    <div className="min-h-screen">
      <main>
        <div className="max-w-7xl mx-auto">
          <div>
            {children}
          </div>
        </div>
      </main>
    </div>
  );
} 