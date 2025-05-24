export interface Index {
  id: string;
  name: string;
  createdAt: string;
  members: number;
  files: IndexFile[];
  suggestedIntents: SuggestedIntent[];
  avatar?: string;
  role?: string;
}

export interface IndexFile {
  name: string;
  size: string;
  date: string;
}

export interface SuggestedIntent {
  id: string;
  title: string;
  isAdded?: boolean;
}

import { apiClient } from '../lib/api';
import { getAuthToken } from '../lib/auth';

// Real API service functions
export const indexesService = {
  getIndexes: async (): Promise<Index[]> => {
    try {
      const token = getAuthToken();
      const response = await apiClient.get('/api/indexes', token || undefined);
      
      // Transform the API response to match our frontend interface
      return response.indexes?.map((index: any) => ({
        id: index.id,
        name: index.name,
        createdAt: new Date(index.createdAt).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }),
        members: index._count?.members || 0,
        files: index.files?.map((file: any) => ({
          name: file.name,
          size: file.size ? `${(file.size / (1024 * 1024)).toFixed(1)} MB` : '0 MB',
          date: new Date(file.createdAt || file.date).toISOString().split('T')[0]
        })) || [],
        suggestedIntents: index.intents?.map((intent: any) => ({
          id: intent.id,
          title: intent.title,
          isAdded: false
        })) || []
      })) || [];
    } catch (error) {
      console.error('Error fetching indexes:', error);
      return [];
    }
  },

  getIndex: async (id: string): Promise<Index | undefined> => {
    try {
      const token = getAuthToken();
      const response = await apiClient.get(`/api/indexes/${id}`, token || undefined);
      
      if (!response.index) return undefined;
      
      const index = response.index;
      return {
        id: index.id,
        name: index.name,
        createdAt: new Date(index.createdAt).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }),
        members: index.members?.length || 0,
        files: index.files?.map((file: any) => ({
          name: file.name,
          size: file.size ? `${(file.size / (1024 * 1024)).toFixed(1)} MB` : '0 MB',
          date: new Date(file.createdAt || file.date).toISOString().split('T')[0]
        })) || [],
        suggestedIntents: index.intents?.map((intent: any) => ({
          id: intent.id,
          title: intent.title,
          isAdded: false
        })) || []
      };
    } catch (error) {
      console.error('Error fetching index:', error);
      return undefined;
    }
  },

  createIndex: async (index: Omit<Index, 'id'>): Promise<Index> => {
    try {
      const token = getAuthToken();
      const response = await apiClient.post('/api/indexes', {
        name: index.name,
        memberIds: [] // Add member support if needed
      }, token || undefined);
      
      const newIndex = response.index;
      return {
        id: newIndex.id,
        name: newIndex.name,
        createdAt: new Date(newIndex.createdAt).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }),
        members: newIndex.members?.length || 0,
        files: [],
        suggestedIntents: []
      };
    } catch (error) {
      console.error('Error creating index:', error);
      throw error;
    }
  },

  updateIndex: async (id: string, updates: Partial<Index>): Promise<Index | undefined> => {
    try {
      const token = getAuthToken();
      const response = await apiClient.put(`/api/indexes/${id}`, {
        name: updates.name
      }, token || undefined);
      
      if (!response.index) return undefined;
      
      const index = response.index;
      return {
        id: index.id,
        name: index.name,
        createdAt: new Date(index.createdAt).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }),
        members: index.members?.length || 0,
        files: index.files?.map((file: any) => ({
          name: file.name,
          size: file.size ? `${(file.size / (1024 * 1024)).toFixed(1)} MB` : '0 MB',
          date: new Date(file.createdAt || file.date).toISOString().split('T')[0]
        })) || [],
        suggestedIntents: index.intents?.map((intent: any) => ({
          id: intent.id,
          title: intent.title,
          isAdded: false
        })) || []
      };
    } catch (error) {
      console.error('Error updating index:', error);
      return undefined;
    }
  },

  deleteIndex: async (id: string): Promise<boolean> => {
    try {
      const token = getAuthToken();
      await apiClient.delete(`/api/indexes/${id}`, token || undefined);
      return true;
    } catch (error) {
      console.error('Error deleting index:', error);
      return false;
    }
  },

  uploadFile: async (indexId: string, file: File): Promise<IndexFile> => {
    try {
      const token = getAuthToken();
      const formData = new FormData();
      formData.append('file', file);
      
      // Note: This will need a separate multipart/form-data handler
      // For now, simulate the upload since the API client is JSON-only
      const baseUrl = typeof window !== 'undefined' 
        ? (process.env.NEXT_PUBLIC_PROTOCOL_HOSTNAME || 'http://localhost:3001')
        : (process.env.NEXT_PUBLIC_PROTOCOL_HOSTNAME || 'http://localhost:3001');
      const response = await fetch(`${baseUrl}/api/indexes/${indexId}/files`, {
        method: 'POST',
        headers: {
          ...(token && { 'Authorization': `Bearer ${token}` })
        },
        body: formData
      });
      
      if (!response.ok) {
        throw new Error(`Upload failed: ${response.status} ${response.statusText}`);
      }
      
      const result = await response.json();
      const uploadedFile = result.file;
      
      return {
        name: uploadedFile.name,
        size: uploadedFile.size ? `${(uploadedFile.size / (1024 * 1024)).toFixed(1)} MB` : '0 MB',
        date: new Date(uploadedFile.createdAt || uploadedFile.date).toISOString().split('T')[0]
      };
    } catch (error) {
      console.error('Error uploading file:', error);
      throw error;
    }
  },

  deleteFile: async (indexId: string, fileName: string): Promise<boolean> => {
    try {
      const token = getAuthToken();
      // This endpoint would need to be implemented in the backend
      await apiClient.delete(`/api/indexes/${indexId}/files/${encodeURIComponent(fileName)}`, token || undefined);
      return true;
    } catch (error) {
      console.error('Error deleting file:', error);
      return false;
    }
  },

  addSuggestedIntent: async (indexId: string, intentId: string): Promise<boolean> => {
    try {
      const token = getAuthToken();
      // This would connect an intent to an index
      await apiClient.post(`/api/indexes/${indexId}/intents`, {
        intentId
      }, token || undefined);
      return true;
    } catch (error) {
      console.error('Error adding suggested intent:', error);
      return false;
    }
  },

  requestConnection: async (indexId: string): Promise<boolean> => {
    try {
      const token = getAuthToken();
      // This endpoint would need to be implemented for connection requests
      await apiClient.post(`/api/indexes/${indexId}/request-connection`, {}, token || undefined);
      return true;
    } catch (error) {
      console.error('Error requesting connection:', error);
      return false;
    }
  }
}; 