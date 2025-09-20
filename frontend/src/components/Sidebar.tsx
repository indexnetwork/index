'use client';

import { useState, useEffect, useCallback } from 'react';
import { useIndexes } from '@/contexts/APIContext';
import { useIndexFilter } from '@/contexts/IndexFilterContext';
import { Index as IndexType } from '@/lib/types';
import IndexMemberSettings from '@/components/modals/IndexMemberSettings';

interface IndexItem {
  id: string;
  name: string;
  isSelectAll?: boolean;
  isSelected?: boolean;
  fullIndex?: IndexType;
}

export default function Sidebar() {
  const [indexes, setIndexes] = useState<IndexItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedIndexId, setSelectedIndexId] = useState<string>('all');
  const [selectedIndexSettings, setSelectedIndexSettings] = useState<IndexType | null>(null);
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
          isSelected: selectedIndexId === index.id,
          fullIndex: index
        }))
      ];
      setIndexes(indexItems);
    } catch (error) {
      console.error('Error fetching indexes:', error);
      setIndexes([{ id: 'all', name: 'All Indexes', isSelectAll: true, isSelected: true }]);
    } finally {
      setLoading(false);
    }
  }, [indexesService]); // Remove selectedIndexId dependency

  useEffect(() => {
    fetchIndexes();
  }, [fetchIndexes]);

  // Update selection state without refetching indexes
  useEffect(() => {
    setIndexes(prevIndexes => 
      prevIndexes.map(index => ({
        ...index,
        isSelected: index.id === selectedIndexId
      }))
    );
  }, [selectedIndexId]);

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

  return (
    <div className="space-y-6 font-mono">
      <div className="bg-white rounded-sm border-black border p-3 pb-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-semibold text-black">Networks</h2>
        </div>
        
        <div className="space-y-1.5">
          {loading ? (
            <div className="text-center text-gray-500 py-4">
              Loading indexes...
            </div>
          ) : (
            indexes.map((index) => (
              <div
                key={index.id}
                onClick={() => handleIndexClick(index.id)}
                className={`flex items-center justify-between group rounded cursor-pointer px-3 py-3 ${
                  index.isSelected ? 'bg-gray-100' : 'hover:bg-gray-50'
                }`}
              >
                <div className="flex items-center min-w-0">
                  <span
                    className={`text-[14px] text-black truncate ${index.isSelected ? 'font-bold' : ''}`}
                    title={index.name}
                  >
                    {index.name}
                  </span>
                </div>
                {!index.isSelectAll && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      if (index.fullIndex) {
                        setSelectedIndexSettings(index.fullIndex);
                      }
                    }}
                    className="p-1 hover:bg-gray-200 rounded opacity-0 group-hover:opacity-100 transition-opacity"
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

      {selectedIndexSettings && (
        <IndexMemberSettings
          open={!!selectedIndexSettings}
          onOpenChange={(open) => !open && setSelectedIndexSettings(null)}
          index={selectedIndexSettings}
        />
      )}
    </div>
  );
}
