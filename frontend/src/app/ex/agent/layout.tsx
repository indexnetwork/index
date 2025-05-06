'use client';

import AgentNavigation from '@/components/AgentNavigation';

export default function AgentLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen">
      <AgentNavigation />
      <div>
        {children}
      </div>
    </div>
  );
} 