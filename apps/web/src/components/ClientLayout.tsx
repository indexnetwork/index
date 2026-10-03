import { PropsWithChildren } from 'react';

interface ClientLayoutProps extends PropsWithChildren {
  hideFeedback?: boolean;
}

export default function ClientLayout({ children }: ClientLayoutProps) {
  return <>{children}</>;
}