import { useMemo } from 'react';
import { FileRecord } from '../../types';
import { apiClient } from '@/lib/api';

export type UploadListResponse = {
  files: FileRecord[];
  pagination: { current: number; total: number; count: number; totalCount: number };
};

export const createUploadServiceV2 = () => ({
  uploadFile: async (file: File): Promise<FileRecord> => {
    const data = await apiClient.uploadFile<{ file: FileRecord }>('/storage/files', file);
    return data.file;
  },

  getFiles: async (page: number = 1, limit: number = 100): Promise<UploadListResponse> => {
    const data = await apiClient.get<UploadListResponse>(`/storage/files?page=${page}&limit=${limit}`);
    return {
      files: data.files ?? [],
      pagination: data.pagination ?? { current: page, total: 0, count: 0, totalCount: 0 },
    };
  },
});

export function useUploadServiceV2() {
  return useMemo(() => createUploadServiceV2(), []);
}
