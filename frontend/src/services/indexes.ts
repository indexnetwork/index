import { useMemo } from 'react';
import { useAuthenticatedAPI } from '../lib/api';
import { 
  Index, 
  IndexFile, 
  PaginatedResponse, 
  APIResponse, 
  CreateIndexRequest, 
  UpdateIndexRequest, 
  FileUploadResponse 
} from '../lib/types';

// Re-export types for convenience
export type { Index, IndexFile };

// Legacy interface for backward compatibility
export interface SuggestedIntent {
  id: string;
  payload: string;
  isAdded?: boolean;
}

// Helper function to format file size (currently unused)
// function formatFileSize(sizeInBytes: number): string {
//   const units = ['B', 'KB', 'MB', 'GB'];
//   let size = sizeInBytes;
//   let unitIndex = 0;
//   
//   while (size >= 1024 && unitIndex < units.length - 1) {
//     size /= 1024;
//     unitIndex++;
//   }
//   
//   return `${size.toFixed(1)} ${units[unitIndex]}`;
// }

// Helper function to format date (currently unused)
// function formatDate(dateString: string): string {
//   return new Date(dateString).toLocaleDateString('en-US', {
//     year: 'numeric',
//     month: 'short',
//     day: 'numeric'
//   });
// }

// Service functions that accept API instance as parameter
export const createIndexesService = (api: ReturnType<typeof useAuthenticatedAPI>) => ({
  // Get all indexes with pagination
  getIndexes: async (page: number = 1, limit: number = 10): Promise<PaginatedResponse<Index>> => {
    console.log('getIndexes', page, limit);
    const response = await api.get<PaginatedResponse<Index>>(`/indexes?page=${page}&limit=${limit}`);
    return response;
  },

  // Get single index by ID
  getIndex: async (id: string): Promise<Index> => {
    const response = await api.get<APIResponse<Index>>(`/indexes/${id}`);
    if (!response.index) {
      throw new Error('Index not found');
    }
    return response.index;
  },

  // Create new index
  createIndex: async (data: CreateIndexRequest): Promise<Index> => {
    const response = await api.post<APIResponse<Index>>('/indexes', data);
    if (!response.index) {
      throw new Error('Failed to create index');
    }
    return response.index;
  },

  // Update index
  updateIndex: async (id: string, data: UpdateIndexRequest): Promise<Index> => {
    const response = await api.put<APIResponse<Index>>(`/indexes/${id}`, data);
    if (!response.index) {
      throw new Error('Failed to update index');
    }
    return response.index;
  },

  // Delete index
  deleteIndex: async (id: string): Promise<void> => {
    await api.delete(`/indexes/${id}`);
  },

  // Upload file to index
  uploadFile: async (indexId: string, file: File): Promise<IndexFile> => {
    const response = await api.uploadFile<FileUploadResponse>(`/indexes/${indexId}/files`, file);
    return response.file;
  },

  // Delete file from index
  deleteFile: async (indexId: string, fileId: string): Promise<void> => {
    await api.delete(`/indexes/${indexId}/files/${fileId}`);
  },

  // Add index member
  addMember: async (indexId: string, userId: string): Promise<void> => {
    await api.post(`/indexes/${indexId}/members`, { userId });
  },

  // Remove index member
  removeMember: async (indexId: string, userId: string): Promise<void> => {
    await api.delete(`/indexes/${indexId}/members/${userId}`);
  },

  // Get suggested intents for an index
  getSuggestedIntents: async (indexId: string): Promise<{ payload: string; confidence: number }[]> => {
    const response = await api.get<{ intents: { payload: string; confidence: number }[] }>(`/indexes/${indexId}/suggested_intents`);
    return response.intents;
  },

  // Legacy methods for backward compatibility (these would need intent service integration)
  addSuggestedIntent: async (indexId: string, intentId: string): Promise<boolean> => {
    try {
      await api.post(`/intents/${intentId}/indexes`, { indexIds: [indexId] });
      return true;
    } catch {
      return false;
    }
  },


});

// Legacy service object for backward compatibility - but this will cause hook errors!
// Keeping for any existing code that might import it directly
export const indexesService = {
  getIndexes: () => { throw new Error('Use useIndexService() hook instead of indexesService directly'); },
  getIndex: () => { throw new Error('Use useIndexService() hook instead of indexesService directly'); },
  createIndex: () => { throw new Error('Use useIndexService() hook instead of indexesService directly'); },
  updateIndex: () => { throw new Error('Use useIndexService() hook instead of indexesService directly'); },
  deleteIndex: () => { throw new Error('Use useIndexService() hook instead of indexesService directly'); },
  uploadFile: () => { throw new Error('Use useIndexService() hook instead of indexesService directly'); },
  deleteFile: () => { throw new Error('Use useIndexService() hook instead of indexesService directly'); },
  addMember: () => { throw new Error('Use useIndexService() hook instead of indexesService directly'); },
  removeMember: () => { throw new Error('Use useIndexService() hook instead of indexesService directly'); },
  addSuggestedIntent: () => { throw new Error('Use useIndexService() hook instead of indexesService directly'); }
};

// Hook for using indexes service with proper error handling
export function useIndexService() {
  const api = useAuthenticatedAPI();
  return useMemo(() => createIndexesService(api), [api]);
} 