import '@testing-library/jest-dom';
import { screen, fireEvent } from '@testing-library/react';
import AskInput from '../../src/components/AskInput';
import { renderComponent } from '../mocks/mockProviders';
import { mockChatData, mockThemeData } from '../mocks/mockData';

describe('AskInput', () => {
  let chatData: any;
  let themeData: any;

  beforeEach(() => {
    chatData = { ...mockChatData };
    themeData = { ... mockThemeData };
    jest.clearAllMocks();
  });

  it('renders input field and send button', () => {
    renderComponent(chatData, themeData, AskInput);

    expect(screen.getByLabelText('ask-input')).toBeInTheDocument();
    expect(screen.getByRole('button')).toBeInTheDocument();
  });

  it('updates input value on change', () => {
    renderComponent(chatData, themeData, AskInput);

    const input = screen.getByLabelText('ask-input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'Test Query' } });
    expect(input.value).toBe('Test Query');
  });

  it('calls sendMessage on send button click with non-empty input', () => {
    chatData.sendMessage = jest.fn();
    renderComponent(chatData, themeData, AskInput);

    const input = screen.getByLabelText('ask-input');
    fireEvent.change(input, { target: { value: 'Test Query' } });
    fireEvent.click(screen.getByRole('button'));

    expect(chatData.sendMessage).toHaveBeenCalledWith('Test Query');
  });

  it('calls sendMessage on enter key press with non-empty input', () => {
    renderComponent(chatData, themeData, AskInput);

    const input = screen.getByLabelText('ask-input');
    fireEvent.change(input, { target: { value: 'Test Query' } });
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });

    expect(chatData.sendMessage).toHaveBeenCalledWith('Test Query');
  });

});