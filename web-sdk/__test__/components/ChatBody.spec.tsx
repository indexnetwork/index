import '@testing-library/jest-dom';
import { screen } from '@testing-library/react';
import ChatBody from '../../src/components/ChatBody';
import { renderComponent } from '../mocks/mockProviders'
import { mockChatData, mockThemeData } from '../mocks/mockData';

describe('ChatBody', () => {
  let chatData: any;
  let themeData: any;

  beforeEach(() => {
    chatData = { ...mockChatData };
    themeData = { ...mockThemeData };
    jest.clearAllMocks();
  });

  it('renders messages correctly', () => {
    renderComponent(chatData, themeData, ChatBody);

    expect(screen.getByLabelText('chat-message')).toBeInTheDocument();
  });

  it('renders a placeholder when there are no messages', () => {
    chatData.messages = [];
    renderComponent(chatData, themeData, ChatBody);

    expect(screen.getByLabelText('chat-body-placeholder')).toBeInTheDocument();
    expect(screen.getByRole('img')).toBeInTheDocument();
  });

  it('renders user avatar in message - user', () => {
    renderComponent(chatData, themeData, ChatBody);

    expect(screen.getByAltText('Avatar')).toHaveAttribute('src', 'Test Avatar');
  });

  it('renders user avatar in message - user', () => {
    chatData.userProfile = null;
    renderComponent(chatData, themeData, ChatBody);

    expect(screen.getByAltText('Avatar')).not.toHaveAttribute('src', 'Test Avatar');
  });

  it('renders assistant avatar in message - assistant', () => {
    chatData.messages[0].role = 'assistant';
    renderComponent(chatData, themeData, ChatBody);

    expect(screen.getByAltText('Avatar')).toHaveAttribute('src', 'test-file-stub'); // check img file loader stub
  });
});
