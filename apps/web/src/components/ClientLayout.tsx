import { PropsWithChildren } from 'react';
import FeedbackWidget from './FeedbackWidget';

interface ClientLayoutProps extends PropsWithChildren {
  hideFeedback?: boolean;
}

export default function ClientLayout({ children, hideFeedback }: ClientLayoutProps) {
  // Note: Header is now handled at the root level in ClientWrapper
  // This component now only provides content wrapper functionality
  return (
    <>
      {children}
      {!hideFeedback && <FeedbackWidget />}
    </>
  );
} 