import { useMemo } from 'react';
import { useAuthenticatedAPI } from '../lib/api';
import { FileRecord, FileUploadResponse } from '../types';

// Re-export types for convenience
export type { FileRecord };

export const createFilesService = (api: ReturnType<typeof useAuthenticatedAPI>) => ({
  // Upload a file to the user's Library
  uploadFile: async (file: File): Promise<FileRecord> => {
    const response = await api.uploadFile<FileUploadResponse>(`/files`, file);
    return response.file;
  },

  // Delete a file from the user's Library
  deleteFile: async (fileId: string): Promise<void> => {
    await api.delete(`/files/${fileId}`);
  },

  // Get files (Library-scoped)
  getFiles: async (page: number = 1, limit: number = 100): Promise<FileRecord[]> => {
    const res = await api.get<{ files: FileRecord[]; pagination: { current: number; total: number; count: number; totalCount: number } }>(`/files?page=${page}&limit=${limit}`);
    return res.files || [];
  }
});

// Non-authenticated service for public endpoints
export const filesService = {
  // Legacy methods that require authentication
  uploadFile: () => { throw new Error('Use useFilesService() hook instead of filesService directly'); },
  deleteFile: () => { throw new Error('Use useFilesService() hook instead of filesService directly'); },
  getFiles: () => { throw new Error('Use useFilesService() hook instead of filesService directly'); }
};

// Hook for using files service with proper error handling
export function useFilesService() {
  const api = useAuthenticatedAPI();
  return useMemo(() => createFilesService(api), [api]);
}
