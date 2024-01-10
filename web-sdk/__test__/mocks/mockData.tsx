import { ChatContextType } from '../../src/contexts/ChatContext';
import { ThemeContextType } from '../../src/contexts/ThemeContext';
import { IndexStatus, Participant } from '../../src/types';

export const mockChatData: ChatContextType = {
  messages: [{ content: 'Test Message', role: Participant.User }],
  status: IndexStatus.Init,
  sendMessage: jest.fn(),
  initializeChat: jest.fn(),
  isLoading: false,
  isWalletConnected: false,
  setIsWalletConnected: jest.fn(),
  clearMessages: jest.fn(),
  userProfile: {
    id: 'Test ID',
    name: 'Test User',
    avatar: 'Test Avatar',
    bio: 'Test Bio',
  }
};

export const mockThemeData: ThemeContextType = {
  activeTheme: {
    primary: '#000',
    secondary: '#000',
    pale: '#000',
    border: '#000',
    accent: '#000',
    background: '#000',
  },
  darkMode: false,
  toggleDarkMode: jest.fn(),
};