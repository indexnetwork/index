'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useIndexes } from '@/contexts/APIContext';
import { useIndexFilter } from '@/contexts/IndexFilterContext';
import { Index as IndexType } from '@/lib/types';
import LibraryModal from '@/components/modals/LibraryModal';
import { Input } from '@/components/ui/input';
import { useNotifications } from '@/contexts/NotificationContext';
import { useLibraryService } from '@/services/library';

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
  // Quick-add Library interactions in sidebar
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [isAddingLink, setIsAddingLink] = useState(false);
  const [linkUrl, setLinkUrl] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const library = useLibraryService();
  const { success, error } = useNotifications();
  const indexesService = useIndexes();
  const { selectedIndexIds, setSelectedIndexIds } = useIndexFilter();
  
  console.log('Sidebar rendered, current selectedIndexIds:', selectedIndexIds);

  const fetchIndexes = useCallback(async () => {
    try {
      const response = await indexesService.getIndexes(1, 100); // Get all indexes
      
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
      // Fallback to "Select All" only
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
      // Clear filter to show all indexes
      console.log('Setting filter to empty array (show all)');
      setSelectedIndexIds([]);
    } else {
      // Filter to show only the selected index
      console.log('Setting filter to:', [indexId]);
      setSelectedIndexIds([indexId]);
    }
  };

  // no currentIndexId needed; Library modal is index-agnostic

  const handleDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    const files = e.dataTransfer?.files || null;
    if (files && files.length > 0) {
      void handleFilesSelected(files);
    }
  }, []);

  const handleFilesSelected = useCallback(async (f: FileList | null) => {
    if (!f || f.length === 0) return;
    setIsUploading(true);
    try {
      await Promise.all(Array.from(f).map(file => library.uploadFile(file)));
      success('Uploaded');
    } catch {
      error('Upload failed');
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }, [library, success, error]);

  const handleAddLink = useCallback(async () => {
    if (!linkUrl) return;
    let normalized = linkUrl.trim();
    if (!normalized.startsWith('http://') && !normalized.startsWith('https://')) {
      normalized = `https://${normalized}`;
    }
    try {
      setIsAddingLink(true);
      await library.addLink(normalized);
      setLinkUrl('');
      success('Link added');
    } catch {
      error('Failed to add link');
    } finally {
      setIsAddingLink(false);
    }
  }, [library, linkUrl, success, error]);

  return (
    <div className="space-y-6 font-mono">
      {/* Indexes Section */}
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
                <div className="flex items-center">
                  <span className="text-sm text-black">{index.name}</span>
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

      {/* Library Section */}
      <div className="bg-white rounded-sm border-black border p-3 pb-6">
        <div className="mb-2">
          <h2 className="text-xl font-semibold text-black">Library</h2>
          <p className="text-sm text-black/80 mt-1">Keep files and links to boost relevancy.</p>
        </div>

        {/* Primary CTA to open modal */}
        <button
          onClick={() => setShowLibraryModal(true)}
          className="mt-2 inline-flex w-full items-center justify-center gap-2 bg-black text-white px-3 py-2 rounded-[1px] text-sm cursor-pointer hover:bg-gray-900"
          aria-label="Add to Library"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="5" x2="12" y2="19"></line>
            <line x1="5" y1="12" x2="19" y2="12"></line>
          </svg>
          <span>Add to Library…</span>
        </button>

        {/* Divider */}
        <div className="flex items-center gap-3 my-4">
          <div className="flex-1 h-px bg-gray-300" />
          <span className="text-[11px] text-gray-500">or quick add</span>
          <div className="flex-1 h-px bg-gray-300" />
        </div>

        {/* Quick add controls (match LibraryModal) */}
        <div className="mt-4 space-y-3">
          {/* File upload */}
          <div className="border border-gray-400 rounded-[1px] p-3">
            <div
              className={`border border-dashed ${isDragging ? 'border-gray-600 bg-gray-100' : 'border-gray-400'} bg-gray-50 p-6 text-center cursor-pointer transition-colors rounded-[1px] flex items-center justify-center min-h-[80px]`}
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
                  <div className="w-6 h-6 mx-auto border-2 border-gray-400 border-t-transparent rounded-full animate-spin" />
                  <div className="text-xs text-gray-600">Uploading…</div>
                </div>
              ) : (
                <div className="space-y-1">
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="mx-auto text-gray-500">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                    <polyline points="14,2 14,8 20,8"></polyline>
                    <line x1="16" y1="13" x2="8" y2="13"></line>
                    <line x1="16" y1="17" x2="8" y2="17"></line>
                    <polyline points="10,9 9,9 8,9"></polyline>
                  </svg>
                  <div className="text-xs text-gray-500">Drop files or click</div>
                </div>
              )}
            </div>
          </div>

          {/* Link input */}
          <div className="border border-gray-400 rounded-[1px] p-3 flex items-center">
            <div className="flex items-center gap-2 w-full">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-gray-500 flex-shrink-0">
                <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path>
                <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path>
              </svg>
              <Input
                placeholder="Paste URL here"
                value={linkUrl}
                onChange={(e) => setLinkUrl(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleAddLink(); }}
                className="text-sm border-gray-400 rounded-[1px] flex-1"
              />
              {isAddingLink ? (
                <div className="w-8 h-8 border-2 border-gray-400 border-t-transparent rounded-full animate-spin flex-shrink-0" />
              ) : (
                <button
                  onClick={handleAddLink}
                  disabled={!linkUrl}
                  className="p-1.5 hover:bg-gray-100 rounded-[1px] cursor-pointer transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex-shrink-0"
                  aria-label="Add URL"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-gray-600">
                    <line x1="12" y1="5" x2="12" y2="19"></line>
                    <line x1="5" y1="12" x2="19" y2="12"></line>
                  </svg>
                </button>
              )}
            </div>
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
