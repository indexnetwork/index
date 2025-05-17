'use client';

import { PropsWithChildren } from 'react';
import Header from "@/components/Header";

interface ClientLayoutProps extends PropsWithChildren {
  showNavigation?: boolean;
}

export default function ClientLayout({ children, showNavigation = true }: ClientLayoutProps) {
  return (
    <div className="backdrop relative min-h-screen">
      <style jsx>{`
        .backdrop:after {
          content: "";
          position: fixed;
          left: 0;
          top: 0;
          bottom: 0;
          right: 0;
          background: url(https://www.trychroma.com/img/noise.jpg);
          opacity: .12;
          pointer-events: none;
          z-index: -1;
        }
      `}</style>
      <div className="max-w-7xl mx-auto px-2">
        <Header showNavigation={showNavigation} />
      </div>
      
      <main>
        <div className={`flex-1 px-2 ${showNavigation ? 'max-w-4xl' : 'max-w-6xl'} mx-auto`}>
          <div className="space-y-6 h-full">
            {children}
          </div>
        </div>
      </main>
    </div>
  );
} 