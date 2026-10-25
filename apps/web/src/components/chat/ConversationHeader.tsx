import type { ReactNode } from 'react';

/** Shared sticky header for human and agent conversation views. */
export default function ConversationHeader({ children }: { children: ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", borderBottom: "1px solid var(--wb-hairline)", padding: "8px 12px" }}>
      {children}
    </div>
  );
}
