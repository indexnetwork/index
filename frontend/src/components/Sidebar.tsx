'use client';

import { useState, useEffect, useCallback } from 'react';
import { useIndexes } from '@/contexts/APIContext';
import { useIndexFilter } from '@/contexts/IndexFilterContext';
import { Index as IndexType } from '@/lib/types';

interface IndexFilter {
  id: string;
  name: string;
  checked: boolean;
  hasSettings?: boolean;
}

export default function Sidebar() {
  const [indexes, setIndexes] = useState<IndexFilter[]>([]);
  const [loading, setLoading] = useState(true);
  const indexesService = useIndexes();
  const { setSelectedIndexIds } = useIndexFilter();

  const fetchIndexes = useCallback(async () => {
    try {
      const response = await indexesService.getIndexes(1, 100); // Get all indexes
      const indexFilters: IndexFilter[] = [
        { id: 'all', name: 'All Indexes', checked: true, hasSettings: false },
        ...response.indexes.map((index: IndexType) => ({
          id: index.id,
          name: index.title,
          checked: false,
          hasSettings: true
        }))
      ];
      setIndexes(indexFilters);
    } catch (error) {
      console.error('Error fetching indexes:', error);
      // Fallback to "All Indexes" only
      setIndexes([{ id: 'all', name: 'All Indexes', checked: true, hasSettings: false }]);
    } finally {
      setLoading(false);
    }
  }, [indexesService]);

  useEffect(() => {
    fetchIndexes();
  }, [fetchIndexes]);

  const getSelectedIndexIds = useCallback(() => {
    const selectedIndexes = indexes.filter(index => index.checked && index.id !== 'all');
    return selectedIndexes.map(index => index.id);
  }, [indexes]);

  useEffect(() => {
    const selectedIds = getSelectedIndexIds();
    setSelectedIndexIds(selectedIds);
  }, [indexes, getSelectedIndexIds, setSelectedIndexIds]);

  const toggleIndex = (id: string) => {
    setIndexes(prev => {
      if (id === 'all') {
        // If toggling "All", uncheck all others and set "All" to checked
        return prev.map(index => ({
          ...index,
          checked: index.id === 'all'
        }));
      } else {
        // If toggling a specific index, uncheck "All" and toggle the specific index
        return prev.map(index => {
          if (index.id === 'all') {
            return { ...index, checked: false };
          } else if (index.id === id) {
            return { ...index, checked: !index.checked };
          }
          return index;
        });
      }
    });
  };

  return (
    <div className="space-y-6 font-mono">
      {/* Indexes Section */}
      <div className="sticky bg-white rounded-md border-black border p-3 pb-6">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-semibold text-black">Indexes</h2>
          <button className="px-4 py-2 border border-black rounded hover:bg-gray-50 text-sm font-medium text-black">
            New
          </button>
        </div>
        
        <div className="space-y-3">
          {loading ? (
            <div className="text-center text-gray-500 py-4">
              Loading indexes...
            </div>
          ) : (
            indexes.map((index) => (
              <div key={index.id} className="flex items-center justify-between group">
                <label className="flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={index.checked}
                    onChange={() => toggleIndex(index.id)}
                    className="mr-3 h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                  />
                  <span className="text-sm text-black">{index.name}</span>
                </label>
                {index.hasSettings && (
                  <button className="opacity-0 group-hover:opacity-100 transition-opacity p-1 hover:bg-gray-100 rounded">
                    <svg className="w-4 h-4 text-black" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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

      {/* Files Section */}
      <div className="bg-white rounded-sm border-black border p-3 pb-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-semibold text-black">Files</h2>
          <button className="text-sm text-black hover:text-gray-700 font-medium">
            + Add new file
          </button>
        </div>
        
        <p className="text-sm text-black mb-4">To boost your relevancy</p>
        
        {/* File Drop Area */}
        <div className="border-2 border-dashed border-black rounded-lg p-8 text-center hover:border-gray-600 transition-colors bg-gray-50">
          <p className="text-black text-sm mb-4">Drop your files</p>
        </div>
        
        <div className="mt-4 pt-4 border-t border-black">
          <p className="text-sm text-black">paste links</p>
        </div>
      </div>
    </div>
  );
}
