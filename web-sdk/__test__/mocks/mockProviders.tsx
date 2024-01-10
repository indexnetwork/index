import React, { ReactNode } from 'react';
import { ChatContext, ThemeContext } from '../../src/contexts';
import { render } from '@testing-library/react';

export const mockChatProvider = ({ children, mockData }: { children: React.ReactNode, mockData: any }) => (
  <ChatContext.Provider value={mockData}>
    {children}
  </ChatContext.Provider>
);

export const mockThemeProvider = ({ children, mockData }: { children: React.ReactNode, mockData: any }) => (
  <ThemeContext.Provider value={mockData}>
    {children}
  </ThemeContext.Provider>
);


type MockProviderProps = {
  children: ReactNode;
};

export const mockContext = <T,>(Context: React.Context<T>, value: T) => {
  return ({ children }: MockProviderProps) => (
    <Context.Provider value={value}>{children}</Context.Provider>
  );
};


export const renderComponent = (chatData: any, themeData: any, Component: React.FC<any>) => {
  const MockChatProvider = mockContext(ChatContext, chatData);
  const MockThemeProvider = mockContext(ThemeContext, themeData);

  return render(
    <MockThemeProvider>
      <MockChatProvider>
        <Component />
      </MockChatProvider>
    </MockThemeProvider>
  );
};