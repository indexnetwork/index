'use client';

import { ContentContainer } from './ContentContainer';

interface ChatLayoutProps {
  header?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
}

export function ChatLayout({ header, children, footer }: ChatLayoutProps) {
  return (
    <>
      {header && (
        <div className="sticky top-0 bg-background border-b border-border z-10 px-4 py-3 min-h-[68px]">
          {header}
        </div>
      )}
      <div className="px-6 lg:px-8 py-6 pb-32 flex-1">
        <ContentContainer className="flex flex-col">
          {children}
        </ContentContainer>
      </div>
      {footer && (
        <div className="fixed bottom-0 left-0 right-0 lg:left-64 bg-background border-t border-border z-20">
          <div className="px-6 lg:px-8 py-4">
            <ContentContainer>{footer}</ContentContainer>
          </div>
        </div>
      )}
    </>
  );
}
