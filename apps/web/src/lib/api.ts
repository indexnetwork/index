import { useCallback, useMemo, useRef } from 'react';

import { authClient, getJwtToken } from './auth-client';

// In production, VITE_PROTOCOL_URL points to the protocol service; in dev, Vite proxies /api
const PROTOCOL_BASE = import.meta.env.VITE_PROTOCOL_URL || '';
const API_BASE_URL = `${PROTOCOL_BASE}/api`;

/** Prefix an /api/... path with the protocol origin when running in production. */
export function apiUrl(path: string): string {
  return `${PROTOCOL_BASE}${path}`;
}

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
    options: RequestInit & { skipAuth?: boolean } = {}
  ): Promise<T> {
    const url = `${this.baseURL}${endpoint}`;
    const { skipAuth, ...fetchOptions } = options;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(fetchOptions.headers as Record<string, string>),
    };

    if (!skipAuth) {
      const token = await getJwtToken();
      headers['Authorization'] = `Bearer ${token}`;
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
  async get<T>(endpoint: string, options?: { signal?: AbortSignal }): Promise<T> {
    return this.request<T>(endpoint, {
      method: 'GET',
      signal: options?.signal,
    });
  }

  // GET request without authentication (for public endpoints)
  async getPublic<T>(endpoint: string, options?: { signal?: AbortSignal }): Promise<T> {
    return this.request<T>(endpoint, {
      method: 'GET',
      signal: options?.signal,
      skipAuth: true,
    });
  }

  // POST request
  async post<T>(endpoint: string, data?: unknown): Promise<T> {
    return this.request<T>(endpoint, {
      method: 'POST',
      body: data ? JSON.stringify(data) : undefined,
    });
  }

  // PUT request
  async put<T>(endpoint: string, data?: unknown): Promise<T> {
    return this.request<T>(endpoint, {
      method: 'PUT',
      body: data ? JSON.stringify(data) : undefined,
    });
  }

  // PATCH request
  async patch<T>(endpoint: string, data?: unknown): Promise<T> {
    return this.request<T>(endpoint, {
      method: 'PATCH',
      body: data ? JSON.stringify(data) : undefined,
    });
  }

  // DELETE request
  async delete<T>(endpoint: string): Promise<T> {
    return this.request<T>(endpoint, {
      method: 'DELETE',
    });
  }

  /** POST that returns the raw Response (for SSE / streaming). */
  async stream(
    endpoint: string,
    data?: unknown,
    options?: { signal?: AbortSignal }
  ): Promise<Response> {
    const url = `${this.baseURL}${endpoint}`;
    const token = await getJwtToken();
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: data ? JSON.stringify(data) : undefined,
      signal: options?.signal,
    });
    return response;
  }

  /** Throw an APIError built from a non-ok upload response body. */
  private async throwUploadError(response: Response): Promise<never> {
    let errorMessage = `HTTP ${response.status}: ${response.statusText}`;
    try {
      const errorData = await response.json();
      errorMessage = errorData.error || errorData.message || errorMessage;
    } catch {
      // If JSON parsing fails, keep the default message
    }
    throw new APIError(errorMessage, response.status);
  }

  /** POST a FormData body (multiple files / fields). */
  async uploadFormData<T>(endpoint: string, formData: FormData): Promise<T> {
    const url = `${this.baseURL}${endpoint}`;
    const token = await getJwtToken();
    const response = await fetch(url, {
      method: 'POST',
      body: formData,
      headers: { 'Authorization': `Bearer ${token}` },
    });

    if (!response.ok) await this.throwUploadError(response);

    return response.json();
  }

  // File upload
  async uploadFile<T>(
    endpoint: string,
    file: File,
    additionalData?: Record<string, string>,
    fieldName: string = 'file'
  ): Promise<T> {
    const formData = new FormData();
    formData.append(fieldName, file);

    // Add any additional form data
    if (additionalData) {
      Object.entries(additionalData).forEach(([key, value]) => {
        formData.append(key, value);
      });
    }

    const token = await getJwtToken();
    const response = await fetch(`${this.baseURL}${endpoint}`, {
      method: 'POST',
      body: formData,
      headers: { 'Authorization': `Bearer ${token}` },
    });

    if (!response.ok) await this.throwUploadError(response);

    return response.json();
  }
}

// Default API client instance
export const apiClient = new APIClient();

// Hook for authenticated API calls (Better Auth cookie-based sessions)
export function useAuthenticatedAPI() {
  const session = authClient.useSession();

  // Use a ref to hold the current session, so the callback doesn't depend on session object reference.
  // This prevents unnecessary recreations when session refreshes but auth state doesn't change.
  const sessionRef = useRef(session.data?.session);
  sessionRef.current = session.data?.session;

  // Only depend on whether we're authenticated (boolean), not the session object itself.
  // This keeps the callback stable across session refreshes.
  const isAuthenticated = !!session.data?.session;

  const makeAuthenticatedRequest = useCallback(async <T>(requestFn: () => Promise<T>): Promise<T> => {
    try {
      if (!sessionRef.current) {
        throw new APIError('Authentication system not ready', 401);
      }
      return await requestFn();
    } catch (error) {
      if (error instanceof APIError) {
        throw error;
      }
      throw new APIError(
        error instanceof Error ? error.message : 'Authentication error',
        401
      );
    }
  }, [isAuthenticated]);

  return useMemo(
    () => ({
      get: <T>(endpoint: string, options?: { signal?: AbortSignal }) =>
        makeAuthenticatedRequest<T>(() => apiClient.get<T>(endpoint, options)),

      post: <T>(endpoint: string, data?: unknown) =>
        makeAuthenticatedRequest<T>(() => apiClient.post<T>(endpoint, data)),

      put: <T>(endpoint: string, data?: unknown) =>
        makeAuthenticatedRequest<T>(() => apiClient.put<T>(endpoint, data)),

      patch: <T>(endpoint: string, data?: unknown) =>
        makeAuthenticatedRequest<T>(() => apiClient.patch<T>(endpoint, data)),

      delete: <T>(endpoint: string) =>
        makeAuthenticatedRequest<T>(() => apiClient.delete<T>(endpoint)),

      uploadFile: <T>(
        endpoint: string,
        file: File,
        additionalData?: Record<string, string>,
        fieldName?: string
      ) =>
        makeAuthenticatedRequest<T>(() =>
          apiClient.uploadFile<T>(endpoint, file, additionalData, fieldName)
        ),
    }),
    [makeAuthenticatedRequest]
  );
}

// Legacy alias - uses authenticated requests, may fail if not logged in
export const api = {
  get: <T>(endpoint: string) => apiClient.get<T>(endpoint),
  post: <T>(endpoint: string, data?: unknown) => apiClient.post<T>(endpoint, data),
  put: <T>(endpoint: string, data?: unknown) => apiClient.put<T>(endpoint, data),
  patch: <T>(endpoint: string, data?: unknown) => apiClient.patch<T>(endpoint, data),
  delete: <T>(endpoint: string) => apiClient.delete<T>(endpoint),
};