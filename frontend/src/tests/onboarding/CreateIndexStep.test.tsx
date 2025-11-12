import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import CreateIndexStep from '@/app/onboarding/CreateIndexStep';
import { OnboardingStep } from '@/lib/onboardingTypes';

// Mock services
const mockIndexService = {
  createIndex: vi.fn(),
};

const mockAuthService = {
  updateOnboardingState: vi.fn(),
};

const mockUser = {
  id: 'user-123',
  name: 'John Doe',
  onboarding: {
    flow: 2,
    currentStep: OnboardingStep.CreateIndex,
  },
};

const mockNotificationService = {
  error: vi.fn(),
  success: vi.fn(),
};

const mockOnboardingContext = {
  setCreatedIndex: vi.fn(),
  setCurrentStep: vi.fn(),
  getNextStep: vi.fn(() => OnboardingStep.Connections),
  getPreviousStep: vi.fn(() => OnboardingStep.Profile),
};

const mockIndexesContext = {
  refreshIndexes: vi.fn(),
};

// Mock the hooks
vi.mock('@/contexts/AuthContext', () => ({
  useAuthContext: () => ({
    user: mockUser,
    refetchUser: vi.fn(),
  }),
}));

vi.mock('@/contexts/IndexesContext', () => ({
  useIndexesState: () => mockIndexesContext,
}));

vi.mock('@/contexts/NotificationContext', () => ({
  useNotifications: () => mockNotificationService,
}));

vi.mock('@/contexts/OnboardingContext', () => ({
  useOnboardingContext: () => mockOnboardingContext,
}));

// Mock the services
vi.mock('@/services/indexes', () => ({
  useIndexService: () => mockIndexService,
}));

vi.mock('@/services/auth', () => ({
  useAuthService: () => mockAuthService,
}));

const renderCreateIndexStep = (props = { isLoading: false, setIsLoading: vi.fn() }) => {
  return render(<CreateIndexStep {...props} />);
};

describe('CreateIndexStep', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Form Initialization', () => {
    it('renders form elements correctly', () => {
      renderCreateIndexStep();

      expect(screen.getByText('Create your index.')).toBeInTheDocument();
      expect(screen.getByText('Create a space for your network to discover and share opportunities.')).toBeInTheDocument();
      expect(screen.getByLabelText('Index Name')).toBeInTheDocument();
      expect(screen.getByText('Choose who can discover')).toBeInTheDocument();
      expect(screen.getByText('Anyone can join')).toBeInTheDocument();
      expect(screen.getByText('Private')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /back/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /next/i })).toBeInTheDocument();
    });

    it('initializes with default privacy setting (anyone can join)', () => {
      renderCreateIndexStep();

      const anyoneButton = screen.getByText('Anyone can join').closest('button');
      expect(anyoneButton).toHaveClass('border-[#007EFF]');
    });
  });

  describe('Index Name Input', () => {
    it('updates index name when typing', () => {
      renderCreateIndexStep();

      const nameInput = screen.getByPlaceholderText('John');
      fireEvent.change(nameInput, { target: { value: 'My Awesome Index' } });

      expect(nameInput).toHaveValue('My Awesome Index');
    });

    it('allows creating index with Enter key', () => {
      const setIsLoading = vi.fn();
      mockIndexService.createIndex.mockResolvedValue({
        id: 'index-123',
        title: 'Test Index',
        permissions: { invitationLink: { code: 'abc123' } },
      });
      mockAuthService.updateOnboardingState.mockResolvedValue(undefined);

      renderCreateIndexStep({ isLoading: false, setIsLoading });

      const nameInput = screen.getByPlaceholderText('John');
      fireEvent.change(nameInput, { target: { value: 'Test Index' } });
      fireEvent.keyDown(nameInput, { key: 'Enter' });

      expect(mockIndexService.createIndex).toHaveBeenCalledWith({
        title: 'Test Index',
        joinPolicy: 'anyone',
      });
    });
  });

  describe('Privacy Settings', () => {
    it('toggles to private when private button is clicked', () => {
      renderCreateIndexStep();

      const privateButton = screen.getByText('Private').closest('button');
      fireEvent.click(privateButton);

      expect(privateButton).toHaveClass('border-[#007EFF]');
    });

    it('toggles back to public when anyone button is clicked', () => {
      renderCreateIndexStep();

      const privateButton = screen.getByText('Private').closest('button');
      const anyoneButton = screen.getByText('Anyone can join').closest('button');

      fireEvent.click(privateButton);
      expect(privateButton).toHaveClass('border-[#007EFF]');

      fireEvent.click(anyoneButton);
      expect(anyoneButton).toHaveClass('border-[#007EFF]');
    });
  });

  describe('Form Validation', () => {
    it('disables submit button when index name is empty', () => {
      renderCreateIndexStep();

      const submitButton = screen.getByRole('button', { name: /next/i });
      expect(submitButton).toBeDisabled();
    });

    it('enables submit button when index name is provided', () => {
      renderCreateIndexStep();

      const nameInput = screen.getByPlaceholderText('John');
      const submitButton = screen.getByRole('button', { name: /next/i });

      fireEvent.change(nameInput, { target: { value: 'My Index' } });

      expect(submitButton).not.toBeDisabled();
    });
  });

  describe('Index Creation', () => {
    it('creates public index successfully', async () => {
      const setIsLoading = vi.fn();
      mockIndexService.createIndex.mockResolvedValue({
        id: 'index-123',
        title: 'Public Index',
        permissions: { invitationLink: { code: 'abc123' } },
      });
      mockAuthService.updateOnboardingState.mockResolvedValue(undefined);

      renderCreateIndexStep({ isLoading: false, setIsLoading });

      const nameInput = screen.getByPlaceholderText('John');
      const submitButton = screen.getByRole('button', { name: /next/i });

      fireEvent.change(nameInput, { target: { value: 'Public Index' } });
      fireEvent.click(submitButton);

      await waitFor(() => {
        expect(setIsLoading).toHaveBeenCalledWith(true);
        expect(mockIndexService.createIndex).toHaveBeenCalledWith({
          title: 'Public Index',
          joinPolicy: 'anyone',
        });
        expect(mockOnboardingContext.setCreatedIndex).toHaveBeenCalledWith({
          id: 'index-123',
          name: 'Public Index',
          inviteCode: 'abc123',
        });
        expect(mockAuthService.updateOnboardingState).toHaveBeenCalledWith({
          indexId: 'index-123',
          currentStep: OnboardingStep.Connections,
        });
        expect(mockNotificationService.success).toHaveBeenCalledWith('Index created successfully!');
        expect(mockOnboardingContext.setCurrentStep).toHaveBeenCalledWith(OnboardingStep.Connections);
        expect(setIsLoading).toHaveBeenCalledWith(false);
      });
    });

    it('creates private index successfully', async () => {
      const setIsLoading = vi.fn();
      mockIndexService.createIndex.mockResolvedValue({
        id: 'index-456',
        title: 'Private Index',
        permissions: { invitationLink: { code: 'def456' } },
      });
      mockAuthService.updateOnboardingState.mockResolvedValue(undefined);

      renderCreateIndexStep({ isLoading: false, setIsLoading });

      const nameInput = screen.getByPlaceholderText('John');
      const privateButton = screen.getByText('Private').closest('button');
      const submitButton = screen.getByRole('button', { name: /next/i });

      fireEvent.change(nameInput, { target: { value: 'Private Index' } });
      fireEvent.click(privateButton);
      fireEvent.click(submitButton);

      await waitFor(() => {
        expect(mockIndexService.createIndex).toHaveBeenCalledWith({
          title: 'Private Index',
          joinPolicy: 'invite_only',
        });
      });
    });

    it('handles index creation error', async () => {
      const setIsLoading = vi.fn();
      mockIndexService.createIndex.mockRejectedValue(new Error('API error'));

      renderCreateIndexStep({ isLoading: false, setIsLoading });

      const nameInput = screen.getByPlaceholderText('John');
      const submitButton = screen.getByRole('button', { name: /next/i });

      fireEvent.change(nameInput, { target: { value: 'Failed Index' } });
      fireEvent.click(submitButton);

      await waitFor(() => {
        expect(setIsLoading).toHaveBeenCalledWith(true);
        expect(mockNotificationService.error).toHaveBeenCalledWith('Failed to create index');
        expect(setIsLoading).toHaveBeenCalledWith(false);
      });
    });
  });

  describe('Navigation', () => {
    it('navigates to previous step when back button is clicked', () => {
      renderCreateIndexStep();

      const backButton = screen.getByRole('button', { name: /back/i });
      fireEvent.click(backButton);

      expect(mockOnboardingContext.setCurrentStep).toHaveBeenCalledWith(OnboardingStep.Profile);
    });
  });

  describe('Loading States', () => {
    it('shows loading state during index creation', () => {
      renderCreateIndexStep({ isLoading: true, setIsLoading: vi.fn() });

      const submitButton = screen.getByRole('button', { name: /creating/i });
      expect(submitButton).toBeDisabled();
    });

    it('disables form during loading', () => {
      renderCreateIndexStep({ isLoading: true, setIsLoading: vi.fn() });

      const nameInput = screen.getByPlaceholderText('John');
      const submitButton = screen.getByRole('button', { name: /creating/i });
      const backButton = screen.getByRole('button', { name: /back/i });

      expect(nameInput).toBeDisabled();
      expect(submitButton).toBeDisabled();
      expect(backButton).toBeDisabled();
    });
  });
});
