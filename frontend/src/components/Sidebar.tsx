'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useIndexes } from '@/contexts/APIContext';
import { useIndexFilter } from '@/contexts/IndexFilterContext';
import { Index as IndexType } from '@/lib/types';
import LibraryModal from '@/components/modals/LibraryModal';
import { Input } from '@/components/ui/input';
import { useNotifications } from '@/contexts/NotificationContext';
import { useAuthenticatedAPI } from '@/lib/api';

interface IndexItem {
  id: string;
  name: string;
  isSelectAll?: boolean;
  isSelected?: boolean;
}

export default function Sidebar() {
  const [indexes, setIndexes] = useState<IndexItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedIndexId, setSelectedIndexId] = useState<string>('all');
  const [showLibraryModal, setShowLibraryModal] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [isAddingLink, setIsAddingLink] = useState(false);
  const [linkUrl, setLinkUrl] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const api = useAuthenticatedAPI();
  const { success, error } = useNotifications();
  const indexesService = useIndexes();
  const { setSelectedIndexIds } = useIndexFilter();
  

  const fetchIndexes = useCallback(async () => {
    try {
      const response = await indexesService.getIndexes(1, 100);
      
      if (!response.indexes) {
        setIndexes([{ id: 'all', name: 'All Indexes', isSelectAll: true, isSelected: true }]);
        return;
      }
      
      const indexItems: IndexItem[] = [
        { 
          id: 'all', 
          name: 'All Indexes', 
          isSelectAll: true,
          isSelected: selectedIndexId === 'all'
        },
        ...response.indexes.map((index: IndexType) => ({
          id: index.id,
          name: index.title,
          isSelected: selectedIndexId === index.id
        }))
      ];
      setIndexes(indexItems);
    } catch (error) {
      console.error('Error fetching indexes:', error);
      setIndexes([{ id: 'all', name: 'All Indexes', isSelectAll: true, isSelected: true }]);
    } finally {
      setLoading(false);
    }
  }, [indexesService, selectedIndexId]);

  useEffect(() => {
    fetchIndexes();
  }, [fetchIndexes]);

  const handleIndexClick = (indexId: string) => {
    console.log('Index clicked:', indexId);
    setSelectedIndexId(indexId);
    if (indexId === 'all') {
      console.log('Setting filter to empty array (show all)');
      setSelectedIndexIds([]);
    } else {
      console.log('Setting filter to:', [indexId]);
      setSelectedIndexIds([indexId]);
    }
  };

  const handleDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleFilesSelected = useCallback(async (f: FileList | null) => {
    if (!f || f.length === 0) return;
    setIsUploading(true);
    try {
      const uploaded = await Promise.all(Array.from(f).map(async file => {
        const res = await api.uploadFile<{ file: { id: string; name: string; size: string } }>(`/files`, file);
        return res.file;
      }));
      if (uploaded.length === 1) {
        success('File uploaded successfully', uploaded[0]?.name);
      } else if (uploaded.length > 1) {
        success(`${uploaded.length} files uploaded successfully`);
      }
    } catch {
      error('Upload failed');
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }, [api, error]);

  const handleDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    const files = e.dataTransfer?.files || null;
    if (files && files.length > 0) {
      void handleFilesSelected(files);
    }
  }, [handleFilesSelected]);

  const handleAddLink = useCallback(async () => {
    if (!linkUrl) return;
    let normalized = linkUrl.trim();
    if (!normalized.startsWith('http://') && !normalized.startsWith('https://')) {
      normalized = `https://${normalized}`;
    }
    try {
      setIsAddingLink(true);
      await api.post<{ link: { url: string } }>(`/links`, { url: normalized });
      setLinkUrl('');
      success('Link added successfully');
    } catch {
      error('Failed to add link');
    } finally {
      setIsAddingLink(false);
    }
  }, [api, linkUrl, success, error]);

  return (
    <div className="space-y-6 font-mono">
      <div className="bg-white rounded-sm border-black border p-3 pb-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-semibold text-black">Indexes</h2>
          <button className="text-sm text-black hover:text-gray-700 font-medium">
            + Add new index
          </button>
        </div>
        
        <div className="space-y-3">
          {loading ? (
            <div className="text-center text-gray-500 py-4">
              Loading indexes...
            </div>
          ) : (
            indexes.map((index) => (
              <div 
                key={index.id} 
                onClick={() => handleIndexClick(index.id)}
                className={`flex items-center justify-between group -mx-2 px-2 py-1 rounded cursor-pointer ${
                  index.isSelected ? 'bg-gray-100' : 'hover:bg-gray-50'
                }`}
              >
                <div className="flex items-center min-w-0">
                  <span className="text-sm text-black truncate" title={index.name}>{index.name}</span>
                </div>
                {index.isSelectAll && (
                  <button 
                    onClick={(e) => e.stopPropagation()}
                    className="p-1 hover:bg-gray-200 rounded"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    </svg>
                  </button>
                )}
              </div>
            ))
          )}
        </div>
      </div>

      <div className="bg-white rounded-sm border-black border p-3 pb-6">
        <div className="mb-3">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <h2 className="text-lg sm:text-xl font-semibold text-black">Library</h2>
            <button
              onClick={() => setShowLibraryModal(true)}
              className="inline-flex items-center gap-1.5 text-black px-2 sm:px-3 py-1 sm:py-1.5 text-xs sm:text-sm font-ibm-plex-mono cursor-pointer hover:bg-gray-100 transition-colors rounded-[1px]"
              aria-label="Open Library"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 6h18"></path>
                <path d="M3 12h18"></path>
                <path d="M3 18h18"></path>
              </svg>
              <span>Manage</span>
            </button>
          </div>
          <p className="text-xs sm:text-sm text-black/80 leading-relaxed">Keep files and links to boost relevancy.</p>
        </div>

        <div className="space-y-3">
          <div
            className={`border border-dashed ${isDragging ? 'border-gray-600 bg-gray-100' : 'border-gray-400'} bg-gray-50 p-3 sm:p-6 text-center cursor-pointer transition-colors rounded-[1px] flex items-center justify-center min-h-[60px] sm:min-h-[90px]`}
            onDragOver={handleDragOver}
            onDragEnter={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
          >
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              id="sidebar-file-upload"
              onChange={(e) => handleFilesSelected(e.target.files)}
            />
            {isUploading ? (
              <div className="space-y-2">
                <div className="w-4 h-4 sm:w-5 sm:h-5 mx-auto border-2 border-gray-400 border-t-transparent rounded-full animate-spin" />
                <div className="text-xs text-gray-600">Uploading…</div>
              </div>
            ) : (
              <div className="space-y-1">
                <svg width="18" height="18" className="sm:w-5 sm:h-5 mx-auto text-gray-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                  <polyline points="7,10 12,15 17,10"></polyline>
                  <line x1="12" y1="15" x2="12" y2="3"></line>
                </svg>
                <div className="text-xs text-gray-500 px-2">Drag & drop or click to select</div>
              </div>
            )}
          </div>

          <div className="flex items-center gap-2 w-full">
            <svg width="14" height="14" className="sm:w-4 sm:h-4 text-gray-500 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path>
              <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path>
            </svg>
            <Input
              placeholder="Enter URL..."
              value={linkUrl}
              onChange={(e) => setLinkUrl(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleAddLink(); }}
              className="text-xs sm:text-sm border-gray-400 rounded-[1px] flex-1"
            />
            {isAddingLink ? (
              <div className="w-5 h-5 sm:w-6 sm:h-6 border-2 border-gray-400 border-t-transparent rounded-full animate-spin flex-shrink-0" />
            ) : (
              <button
                onClick={handleAddLink}
                disabled={!linkUrl}
                className="p-1 sm:p-1.5 hover:bg-gray-100 rounded-[1px] cursor-pointer transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex-shrink-0"
                aria-label="Add URL"
              >
                <svg width="12" height="12" className="sm:w-3.5 sm:h-3.5 text-gray-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="12" y1="5" x2="12" y2="19"></line>
                  <line x1="5" y1="12" x2="19" y2="12"></line>
                </svg>
              </button>
            )}
          </div>

        </div>
      </div>

      <LibraryModal
        open={showLibraryModal}
        onOpenChange={setShowLibraryModal}
      />
    </div>
  );
}
