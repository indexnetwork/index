import type { ReactNode } from 'react';

/** Shared sticky header for human and agent conversation views. */
export default function ConversationHeader({ children }: { children: ReactNode }) {
  return (
    <div className="sticky top-0 z-10 flex min-h-[68px] items-center bg-white px-4 py-3">
      {children}
    </div>
  );
}
