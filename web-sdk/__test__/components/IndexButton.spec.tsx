import '@testing-library/jest-dom';
import React from 'react';
import { screen, fireEvent } from '@testing-library/react';
import IndexButton from '../../src/components/IndexButton';
import { renderComponent } from '../mocks/mockProviders';
import { mockThemeData, mockChatData } from '../mocks/mockData';
import { IndexStatus } from '../../src/types';

describe('IndexButton', () => {
  let chatData: any;
  let themeData: any;

  beforeEach(() => {
    chatData = { ...mockChatData };
    themeData = { ...mockThemeData };
    jest.clearAllMocks();
  });

  it('calls initializeChat when clicked', () => {
    const mockInitializer = jest.fn();
    chatData.initializeChat = jest.fn();
    renderComponent(chatData, themeData,
      () => <IndexButton initializer={mockInitializer} status={IndexStatus.Success} />);

    const button = screen.getByRole('button', { name: 'Start Your Chat' });
    fireEvent.click(button);
    expect(mockInitializer).toHaveBeenCalled();
  });

  it('calls the onClick function when clicked', () => {
    const mockInitializer = jest.fn();
    const mockOnClick = jest.fn();
    renderComponent(chatData, themeData,
      () => <IndexButton initializer={mockInitializer} status={IndexStatus.Success} />);

    const button = screen.getByRole('button', { name: 'Start Your Chat' });
    fireEvent.click(button);

    expect(mockOnClick).not.toHaveBeenCalled();
  });

  it('renders the correct button text when status is Init', () => {
    const mockInitializer = jest.fn();
    const mockOnClick = jest.fn();
    chatData.status = IndexStatus.Init;
    renderComponent(chatData, themeData,
      () => <IndexButton initializer={mockInitializer} status={IndexStatus.Init} />);

    const button = screen.getByRole('button', { name: 'Initializing...' });

    expect(mockInitializer).toHaveBeenCalled();
    fireEvent.click(button);

    expect(mockOnClick).not.toHaveBeenCalled();
    expect(button.textContent).toBe('Initializing...');
  });

  it('renders the correct button text when status is Fail', () => {
    const mockInitializer = jest.fn();
    const mockOnClick = jest.fn();
    chatData.status = IndexStatus.Fail;
    renderComponent(chatData, themeData,
      () => <IndexButton initializer={mockInitializer} status={IndexStatus.Fail} />);

    const button = screen.getByRole('button', { name: 'Failed to Initialize' });

    expect(mockInitializer).toHaveBeenCalled();
    fireEvent.click(button);

    expect(mockOnClick).not.toHaveBeenCalled();
    expect(button.textContent).toBe('Failed to Initialize');
  });
});