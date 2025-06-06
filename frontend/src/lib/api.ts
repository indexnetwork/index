import { useCallback, useMemo } from 'react';
import { usePrivy } from '@privy-io/react-auth';

// API Configuration
const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL!;

// Error types
export class APIError extends Error {
  constructor(
    message: string,
    public status: number,
    public response?: unknown
  ) {
    super(message);
    this.name = 'APIError';
  }
}

// API Client class
class APIClient {
  private baseURL: string;

  constructor(baseURL: string = API_BASE_URL) {
    this.baseURL = baseURL;
  }

  private async request<T>(
    endpoint: string,
    options: RequestInit & {
      accessToken?: string;
    } = {}
  ): Promise<T> {
    const { accessToken, ...fetchOptions } = options;
    
    const url = `${this.baseURL}${endpoint}`;
    
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(fetchOptions.headers as Record<string, string>),
    };

    if (accessToken) {
      headers.Authorization = `Bearer ${accessToken}`;
    }

    try {
      const response = await fetch(url, {
        ...fetchOptions,
        headers,
      });

      if (!response.ok) {
        let errorMessage = `HTTP ${response.status}: ${response.statusText}`;
        let errorData;
        
        try {
          errorData = await response.json();
          errorMessage = errorData.error || errorData.message || errorMessage;
        } catch {
          // If JSON parsing fails, keep the default message
        }
        
        throw new APIError(errorMessage, response.status, errorData);
      }

      // Handle empty responses
      const contentType = response.headers.get('content-type');
      if (contentType && contentType.includes('application/json')) {
        return await response.json();
      } else {
        return {} as T;
      }
    } catch (error) {
      if (error instanceof APIError) {
        throw error;
      }
      
      // Network or other errors
      throw new APIError(
        error instanceof Error ? error.message : 'Network error',
        0,
        error
      );
    }
  }

  // GET request
  async get<T>(endpoint: string, accessToken?: string): Promise<T> {
    return this.request<T>(endpoint, {
      method: 'GET',
      accessToken,
    });
  }

  // POST request
  async post<T>(
    endpoint: string,
    data?: unknown,
    accessToken?: string
  ): Promise<T> {
    return this.request<T>(endpoint, {
      method: 'POST',
      body: data ? JSON.stringify(data) : undefined,
      accessToken,
    });
  }

  // PUT request
  async put<T>(
    endpoint: string,
    data?: unknown,
    accessToken?: string
  ): Promise<T> {
    return this.request<T>(endpoint, {
      method: 'PUT',
      body: data ? JSON.stringify(data) : undefined,
      accessToken,
    });
  }

  // PATCH request
  async patch<T>(
    endpoint: string,
    data?: unknown,
    accessToken?: string
  ): Promise<T> {
    return this.request<T>(endpoint, {
      method: 'PATCH',
      body: data ? JSON.stringify(data) : undefined,
      accessToken,
    });
  }

  // DELETE request
  async delete<T>(endpoint: string, accessToken?: string): Promise<T> {
    return this.request<T>(endpoint, {
      method: 'DELETE',
      accessToken,
    });
  }

  // File upload
  async uploadFile<T>(
    endpoint: string,
    file: File,
    accessToken?: string,
    additionalData?: Record<string, string>
  ): Promise<T> {
    const formData = new FormData();
    formData.append('file', file);
    
    // Add any additional form data
    if (additionalData) {
      Object.entries(additionalData).forEach(([key, value]) => {
        formData.append(key, value);
      });
    }

    const headers: Record<string, string> = {};
    if (accessToken) {
      headers.Authorization = `Bearer ${accessToken}`;
    }

    const response = await fetch(`${this.baseURL}${endpoint}`, {
      method: 'POST',
      headers,
      body: formData,
    });

    if (!response.ok) {
      let errorMessage = `HTTP ${response.status}: ${response.statusText}`;
      try {
        const errorData = await response.json();
        errorMessage = errorData.error || errorData.message || errorMessage;
      } catch {
        // If JSON parsing fails, keep the default message
      }
      throw new APIError(errorMessage, response.status);
    }

    return response.json();
  }
}

// Default API client instance
export const apiClient = new APIClient();

// Hook for authenticated API calls
export function useAuthenticatedAPI() {
  const { getAccessToken } = usePrivy();

  const makeAuthenticatedRequest = useCallback(async <T>(
    requestFn: (accessToken: string) => Promise<T>
  ): Promise<T> => {
    try {
      const accessToken = await getAccessToken();
      if (!accessToken) {
        throw new APIError('No access token available', 401);
      }
      return await requestFn(accessToken);
    } catch (error) {
      if (error instanceof APIError) {
        throw error;
      }
      throw new APIError(
        error instanceof Error ? error.message : 'Authentication error',
        401
      );
    }
  }, [getAccessToken]);

  return useMemo(() => ({
    get: <T>(endpoint: string) =>
      makeAuthenticatedRequest<T>((token) => apiClient.get<T>(endpoint, token)),
    
    post: <T>(endpoint: string, data?: unknown) =>
      makeAuthenticatedRequest<T>((token) => apiClient.post<T>(endpoint, data, token)),
    
    put: <T>(endpoint: string, data?: unknown) =>
      makeAuthenticatedRequest<T>((token) => apiClient.put<T>(endpoint, data, token)),
    
    patch: <T>(endpoint: string, data?: unknown) =>
      makeAuthenticatedRequest<T>((token) => apiClient.patch<T>(endpoint, data, token)),
    
    delete: <T>(endpoint: string) =>
      makeAuthenticatedRequest<T>((token) => apiClient.delete<T>(endpoint, token)),
    
    uploadFile: <T>(endpoint: string, file: File, additionalData?: Record<string, string>) =>
      makeAuthenticatedRequest<T>((token) => 
        apiClient.uploadFile<T>(endpoint, file, token, additionalData)
      ),
  }), [makeAuthenticatedRequest]);
}

// Utility function for non-authenticated requests
export const api = {
  get: <T>(endpoint: string) => apiClient.get<T>(endpoint),
  post: <T>(endpoint: string, data?: unknown) => apiClient.post<T>(endpoint, data),
  put: <T>(endpoint: string, data?: unknown) => apiClient.put<T>(endpoint, data),
  patch: <T>(endpoint: string, data?: unknown) => apiClient.patch<T>(endpoint, data),
  delete: <T>(endpoint: string) => apiClient.delete<T>(endpoint),
}; 