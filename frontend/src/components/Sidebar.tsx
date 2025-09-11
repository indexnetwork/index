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
  const { error } = useNotifications();
  const [lastAdded, setLastAdded] = useState<null | { kind: 'file'|'link'; label: string; sub?: string; at: number }>(null);
  const [lastFading, setLastFading] = useState(false);
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

  const handleFilesSelected = useCallback(async (f: FileList | null) => {
    if (!f || f.length === 0) return;
    setIsUploading(true);
    try {
      const uploaded = await Promise.all(Array.from(f).map(file => library.uploadFile(file)));
      const last = uploaded[uploaded.length - 1];
      if (last) setLastAdded({ kind: 'file', label: last.name, sub: last.size, at: Date.now() });
      // show only the micro-toast; suppress global success toast
    } catch {
      error('Upload failed');
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }, [library, error]);

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
      const link = await library.addLink(normalized);
      setLinkUrl('');
      setLastAdded({ kind: 'link', label: link.url, at: Date.now() });
      // show only the micro-toast; suppress global success toast
    } catch {
      error('Failed to add link');
    } finally {
      setIsAddingLink(false);
    }
  }, [library, linkUrl, error]);

  const loadLatest = useCallback(async () => {
    try {
      const [files, links] = await Promise.all([library.getFiles(), library.getLinks()]);
      const lf = (files || []).sort((a,b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];
      const ll = (links || []).sort((a,b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime())[0];
      const lfTime = lf ? new Date(lf.createdAt).getTime() : 0;
      const llTime = ll && ll.createdAt ? new Date(ll.createdAt).getTime() : 0;
      if (lfTime === 0 && llTime === 0) return;
      if (lfTime >= llTime && lf) setLastAdded({ kind: 'file', label: lf.name, sub: lf.size, at: lfTime });
      else if (ll) setLastAdded({ kind: 'link', label: ll.url, at: llTime });
    } catch {
      // ignore
    }
  }, [library]);

  useEffect(() => { loadLatest(); }, [loadLatest]);

  // Auto-hide the "Just added" row after 5 seconds with fade-out
  useEffect(() => {
    if (!lastAdded) return;
    setLastFading(false);
    const t1 = setTimeout(() => setLastFading(true), 4500);
    const t2 = setTimeout(() => { setLastAdded(null); setLastFading(false); }, 5000);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [lastAdded]);

  return (
    <div className="space-y-6 font-mono">
      {/* Indexes Section */}
      <div className="bg-white rounded-sm border-black border p-3 pb-6 relative">
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
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 sm:gap-0">
            <h2 className="text-xl font-semibold text-black">Library</h2>
            <button
              onClick={() => setShowLibraryModal(true)}
              className="inline-flex items-center gap-1.5 text-black px-3 py-1.5 text-sm font-ibm-plex-mono cursor-pointer hover:bg-gray-100 transition-colors self-start sm:self-auto rounded-[1px]"
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
          <p className="text-sm text-black/80 mt-2 leading-relaxed">Keep files and links to boost relevancy.</p>
        </div>

        {/* Quick add controls (match LibraryModal) */}
        <div className="mt-4 space-y-3">
          {/* File upload */}
          <div
            className={`border border-dashed ${isDragging ? 'border-gray-600 bg-gray-100' : 'border-gray-400'} bg-gray-50 p-6 text-center cursor-pointer transition-colors rounded-[1px] flex items-center justify-center min-h-[90px]`}
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
                <div className="w-5 h-5 mx-auto border-2 border-gray-400 border-t-transparent rounded-full animate-spin" />
                <div className="text-xs text-gray-600">Uploading…</div>
              </div>
            ) : (
              <div className="space-y-1">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="mx-auto text-gray-500">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                  <polyline points="7,10 12,15 17,10"></polyline>
                  <line x1="12" y1="15" x2="12" y2="3"></line>
                </svg>
                <div className="text-xs text-gray-500">Drag & drop or click to select</div>
              </div>
            )}
          </div>

          {/* Link input */}
          <div className="flex items-center gap-2 w-full">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-gray-500 flex-shrink-0">
              <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path>
              <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path>
            </svg>
            <Input
              placeholder="Enter URL..."
              value={linkUrl}
              onChange={(e) => setLinkUrl(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleAddLink(); }}
              className="text-sm border-gray-400 rounded-[1px] flex-1"
            />
            {isAddingLink ? (
              <div className="w-6 h-6 border-2 border-gray-400 border-t-transparent rounded-full animate-spin flex-shrink-0" />
            ) : (
              <button
                onClick={handleAddLink}
                disabled={!linkUrl}
                className="p-1.5 hover:bg-gray-100 rounded-[1px] cursor-pointer transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex-shrink-0"
                aria-label="Add URL"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-gray-600">
                  <line x1="12" y1="5" x2="12" y2="19"></line>
                  <line x1="5" y1="12" x2="19" y2="12"></line>
                </svg>
              </button>
            )}
          </div>

          {/* Micro toast: non-intrusive overlay */}
          {lastAdded && (
            <div
              className={`absolute bottom-3 right-3 pointer-events-none transition-opacity duration-500 ${lastFading ? 'opacity-0' : 'opacity-100'}`}
              aria-live="polite"
            >
              <div className="flex items-center gap-2 bg-black text-white rounded-[4px] px-3 py-2 shadow-lg max-w-[260px]">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-white flex-shrink-0">
                  <polyline points="20 6 9 17 4 12"></polyline>
                </svg>
                <div className="text-[12px] leading-tight truncate">
                  Added {lastAdded.kind === 'file' ? 'file' : 'link'}: <span className="font-medium">{lastAdded.label}</span>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      <LibraryModal
        open={showLibraryModal}
        onOpenChange={setShowLibraryModal}
      />
    </div>
  );
}
