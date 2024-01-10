import '@testing-library/jest-dom';
import { screen, fireEvent } from '@testing-library/react';
import ChatHeader from '../../src/components/ChatHeader';
import { renderComponent } from '../mocks/mockProviders';
import { mockChatData, mockThemeData } from '../mocks/mockData';

describe('ChatHeader', () => {
  let chatData: any;
  let themeData: any;

  beforeEach(() => {
    chatData = { ...mockChatData };
    themeData = { ... mockThemeData };
    jest.clearAllMocks();
  });
  
  it('toggles dark mode on button click', () => {
    renderComponent(chatData, themeData, ChatHeader);

    const toggleDarkModeBtn = screen.getByLabelText('toggle-dark-mode');
    fireEvent.click(toggleDarkModeBtn);

    expect(themeData.toggleDarkMode).toHaveBeenCalled();
  });

  it('shows the connect wallet button when the wallet is not connected', () => {
    renderComponent(chatData, themeData, ChatHeader);

    expect(screen.getByText('Connect wallet')).toBeInTheDocument();
  });

  it('connects wallet on button click', () => {
    renderComponent(chatData, themeData, ChatHeader);

    const connectWalletBtn = screen.getByText('Connect wallet');
    fireEvent.click(connectWalletBtn);

    expect(chatData.setIsWalletConnected).toHaveBeenCalledWith(true);
  });

  it('renders user avatar if userProfile is present', () => {
    renderComponent(chatData, themeData, ChatHeader);

    expect(screen.getByRole('img', { name: /User Avatar/i })).toHaveAttribute('src', chatData.userProfile?.avatar);
  });

  it('clears messages on reset button click', () => {
    renderComponent(chatData, themeData, ChatHeader);

    const resetBtn = screen.getByText('Reset');
    fireEvent.click(resetBtn);

    expect(chatData.clearMessages).toHaveBeenCalled();
  });

  it('does not clear messages when isLoading is true', () => {
    chatData.isLoading = true;
    renderComponent(chatData, themeData, ChatHeader);

    const resetBtn = screen.getByText('Reset');
    fireEvent.click(resetBtn);

    expect(chatData.clearMessages).not.toHaveBeenCalled();
  });

  it('does not display reset button if there are no messages', () => {
    chatData.messages = [];
    renderComponent(chatData, themeData, ChatHeader);

    expect(screen.queryByText('Reset')).not.toBeInTheDocument();
  });

  it('doesnt render user avatar if userProfile is null', () => {
    chatData.userProfile = null;
    renderComponent(chatData, themeData, ChatHeader);

    expect(screen.queryByRole('img', { name: /User Avatar/i })).not.toHaveAttribute('src', chatData.userProfile?.avatar);
  });

  it('renders different icons for dark mode', () => {
    themeData.darkMode = true;
    renderComponent(chatData, themeData, ChatHeader);

    expect(screen.getByLabelText('icon-sun')).toBeInTheDocument();
  });

  it('renders different icons for light mode', () => {
    themeData.darkMode = false;
    renderComponent(chatData, themeData, ChatHeader);

    expect(screen.getByLabelText('icon-moon')).toBeInTheDocument();
  });

});
