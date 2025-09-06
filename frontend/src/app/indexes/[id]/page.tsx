"use client";

import { useState, useEffect, useCallback, use, useRef, useMemo } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Upload, Trash2, ArrowUpRight, Share2, ArrowLeft, MoreVertical } from "lucide-react";
import ShareSettingsModal from "@/components/modals/ShareSettingsModal";
import ConfigureModal from "@/components/modals/ConfigureModal";
import DeleteIndexModal from "@/components/modals/DeleteIndexModal";

import Link from "next/link";
import { useIndexes, useIntents } from "@/contexts/APIContext";
import { useAuthenticatedAPI } from "@/lib/api";
import { createSyncService, type SyncRun } from "@/services/sync";
import { useNotifications } from "@/contexts/NotificationContext";
import { Index, Intent } from "@/lib/types";
import ClientLayout from "@/components/ClientLayout";
import { usePrivy } from "@privy-io/react-auth";
import CreateIntentModal from "@/components/modals/CreateIntentModal";
import { Input } from "@/components/ui/input";
import { getIndexFileUrl } from "@/lib/file-utils";
import { formatDate } from "@/lib/utils";

interface IndexDetailPageProps {
  params: Promise<{
    id: string;
  }>;
}

export default function IndexDetailPage({ params }: IndexDetailPageProps) {
  const router = useRouter();
  const resolvedParams = use(params);
  const [isDragging, setIsDragging] = useState(false);
  const [showShareSettingsModal, setShowShareSettingsModal] = useState(false);
  const [showCreateIntentModal, setShowCreateIntentModal] = useState(false);
  const [showConfigDialog, setShowConfigDialog] = useState(false);
  const [selectedSuggestedIntent, setSelectedSuggestedIntent] = useState<{ payload: string; id: string } | null>(null);
  const [index, setIndex] = useState<Index | null>(null);
  const [loading, setLoading] = useState(true);
  const [uploadingFiles, setUploadingFiles] = useState<Set<string>>(new Set());
  const [deletingFiles, setDeletingFiles] = useState<Set<string>>(new Set());
  const [suggestedIntents, setSuggestedIntents] = useState<{ id: string; payload: string; confidence: number }[]>([]);
  const [loadingIntents, setLoadingIntents] = useState(false);
  const [intents, setIntents] = useState<Intent[]>([]);
  const [loadingIndexIntents, setLoadingIndexIntents] = useState(false);
  const [removingIntents, setRemovingIntents] = useState<Set<string>>(new Set());
  const [addingIntents, setAddingIntents] = useState<Set<string>>(new Set());
  const [replacingIntents, setReplacingIntents] = useState<Set<string>>(new Set());
  const [isAutoCreatingIntents, setIsAutoCreatingIntents] = useState(false);
  
  // New state for title editing
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [editedTitle, setEditedTitle] = useState("");
  const [isUpdatingTitle, setIsUpdatingTitle] = useState(false);
  
  // New state for delete confirmation and options menu
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [showOptionsMenu, setShowOptionsMenu] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  
  const indexesService = useIndexes();
  const intentsService = useIntents();
  const { user: currentUser } = usePrivy();
  const intentsRef = useRef<HTMLDivElement>(null);

  // Index Links state
  const [links, setLinks] = useState<Array<{ id: string; url: string; lastSyncAt?: string | null; lastStatus?: string | null; lastError?: string | null }>>([]);
  const [linkUrl, setLinkUrl] = useState("");
  const [addingLink, setAddingLink] = useState(false);
  const [syncingLinks, setSyncingLinks] = useState(false);
  const [lastSyncSummary, setLastSyncSummary] = useState<string>("");
  const [syncProgress, setSyncProgress] = useState<{ completed?: number; total?: number; status?: string } | null>(null);
  const api = useAuthenticatedAPI();
  const syncService = useMemo(() => createSyncService(api), [api]);
  const { success: notifySuccess, error: notifyError, info: notifyInfo } = useNotifications();

  const fetchLinks = useCallback(async () => {
    try {
      const data = await indexesService.getIndexLinks(resolvedParams.id);
      setLinks(data);
    } catch (e) {
      console.error('Error fetching index links:', e);
      setLinks([]);
    }
  }, [indexesService, resolvedParams.id]);

  const fetchIndex = useCallback(async () => {
    try {
      const data = await indexesService.getIndex(resolvedParams.id);
      setIndex(data || null);
    } catch (error) {
      console.error('Error fetching index:', error);
    } finally {
      setLoading(false);
    }
  }, [resolvedParams.id, indexesService]);

  const fetchIndexIntents = useCallback(async () => {
    setLoadingIndexIntents(true);
    try {
      const response = await indexesService.getIndexIntents(resolvedParams.id, 1, 100, false);
      setIntents(response.intents || []);
    } catch (error) {
      console.error('Error fetching index intents:', error);
      setIntents([]);
    } finally {
      setLoadingIndexIntents(false);
    }
  }, [resolvedParams.id, indexesService]);

  const fetchSuggestedIntents = useCallback(async () => {
    if (!index || !index.files || index.files.length === 0) {
      setSuggestedIntents([]);
      return;
    }

    // Skip if suggestions were already set by auto-intent creation
    if (suggestedIntents.length > 0) {
      return;
    }

    setLoadingIntents(true);
    try {
      const response = await indexesService.getSuggestedIntents(resolvedParams.id);
      const intentsWithIds = response.intents.map((intent, index) => ({
        id: `intent-${index}`,
        payload: intent.payload,
        confidence: intent.confidence
      }));
      setSuggestedIntents(intentsWithIds);
      
      // Log cache status for debugging
      if (response.fromCache) {
        console.log(`⚡ Loaded ${response.intents.length} cached suggestions`);
      } else {
        console.log(`🔄 Generated ${response.intents.length} suggestions in ${response.processingTime}ms`);
      }
    } catch (error) {
      console.error('Error fetching suggested intents:', error);
      setSuggestedIntents([]);
    } finally {
      setLoadingIntents(false);
    }
  }, [resolvedParams.id, indexesService, index, suggestedIntents.length]);

  // Auto-create first 5 intents when first file is added to empty index
  const handleAutoIntentCreation = useCallback(async (indexId: string) => {
    setIsAutoCreatingIntents(true);
    
    // Scroll to intents section
    setTimeout(() => {
      intentsRef.current?.scrollIntoView({ 
        behavior: 'smooth',
        block: 'start'
      });
    }, 100);
    
    try {
      console.log('🤖 Auto-creating first 5 intents for new index');
      
      // Fetch 10 suggested intents
      const response = await indexesService.getSuggestedIntents(indexId);
      if (response.intents.length === 0) return;
      
      // Take first 5 for auto-creation, rest for suggestions
      const autoIntents = response.intents.slice(0, 5);
      const remainingSuggestions = response.intents.slice(5);
      
      // Auto-create first 5 intents
      const createdIntents: Intent[] = [];
      for (const suggestedIntent of autoIntents) {
        try {
          const createdIntent = await intentsService.createIntent({
            payload: suggestedIntent.payload,
            indexIds: [indexId],
            isIncognito: false
          });
          
          // Handle user data properly
          if (createdIntent.user && createdIntent.user.name) {
            createdIntents.push(createdIntent);
          } else {
            // Fetch full intent data to get proper user object
            try {
              const fullIntent = await intentsService.getIntent(createdIntent.id);
              createdIntents.push(fullIntent);
            } catch (error) {
              console.error('Error fetching full intent data:', error);
              createdIntents.push(createdIntent); // Use partial as fallback
            }
          }
        } catch (error) {
          console.error('Error auto-creating intent:', error);
        }
      }
      
      // Update intents list with auto-created intents
      if (createdIntents.length > 0) {
        setIntents(prev => [...prev, ...createdIntents]);
      }
      
      // Set remaining suggestions
      const suggestionsWithIds = remainingSuggestions.map((intent, index) => ({
        id: `intent-${Date.now()}-${index}`,
        payload: intent.payload,
        confidence: intent.confidence
      }));
      setSuggestedIntents(suggestionsWithIds);
      
      console.log(`✅ Auto-created ${createdIntents.length} intents, ${suggestionsWithIds.length} suggestions remaining`);
      
    } catch (error) {
      console.error('Error in auto-intent creation:', error);
    } finally {
      setIsAutoCreatingIntents(false);
    }
  }, [indexesService, intentsService]);

  useEffect(() => {
    fetchIndex();
  }, [fetchIndex]);

  useEffect(() => {
    fetchIndexIntents();
  }, [fetchIndexIntents]);

  useEffect(() => {
    fetchSuggestedIntents();
  }, [fetchSuggestedIntents]);

  useEffect(() => {
    fetchLinks();
  }, [fetchLinks]);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    
    const droppedFiles = Array.from(e.dataTransfer.files);
    if (index && droppedFiles.length > 0) {
      const wasEmpty = !index.files || index.files.length === 0;
      
      try {
        // Add files to uploading state
        const newUploadingFiles = new Set(uploadingFiles);
        droppedFiles.forEach(file => newUploadingFiles.add(file.name));
        setUploadingFiles(newUploadingFiles);

        for (const file of droppedFiles) {
          await indexesService.uploadFile(index.id, file);
        }
        // Refresh index data
        const updatedIndex = await indexesService.getIndex(resolvedParams.id);
        setIndex(updatedIndex || null);
        
        // Auto-create intents if this was the first file upload
        if (wasEmpty) {
          await handleAutoIntentCreation(index.id);
        }
      } catch (error) {
        console.error('Error uploading files:', error);
      } finally {
        // Clear uploading state
        setUploadingFiles(new Set());
      }
    }
  };

  const handleFileDelete = async (fileId: string) => {
    if (index) {
      try {
        setDeletingFiles(prev => new Set([...prev, fileId]));
        await indexesService.deleteFile(index.id, fileId);
        // Refresh index data
        const updatedIndex = await indexesService.getIndex(resolvedParams.id);
        setIndex(updatedIndex || null);
      } catch (error) {
        console.error('Error deleting file:', error);
      } finally {
        setDeletingFiles(prev => {
          const newSet = new Set(prev);
          newSet.delete(fileId);
          return newSet;
        });
      }
    }
  };

  const handleAddLink = async () => {
    if (!linkUrl.trim()) return;
    try {
      setAddingLink(true);
      await indexesService.addIndexLink(resolvedParams.id, { url: linkUrl.trim() });
      setLinkUrl("");
      await fetchLinks();
      notifySuccess('Link added', 'Your URL was added to this index.');
    } catch (e) {
      console.error('Error adding link:', e);
      notifyError('Failed to add link');
    } finally {
      setAddingLink(false);
    }
  };

  const handleDeleteLink = async (linkId: string) => {
    try {
      await indexesService.deleteIndexLink(resolvedParams.id, linkId);
      await fetchLinks();
    } catch (e) {
      console.error('Error deleting link:', e);
    }
  };

  const handleSyncLinks = async () => {
    try {
      setSyncingLinks(true);
      setLastSyncSummary("Queued…");
      setSyncProgress({ status: 'queued' });
      const res = await indexesService.syncIndexLinks(resolvedParams.id, { skipBrokers: true });
      const runId = (res as any).runId as string;
      if (!runId) {
        setLastSyncSummary("Failed to enqueue sync");
        setSyncingLinks(false);
        notifyError('Sync failed to start');
        return;
      }
      // Poll for status (SSE alternative)
      const start = Date.now();
      let stop = false;
      const poll = async () => {
        if (stop) return;
        try {
          const data = await syncService.getRun(runId);
          const run = data.run as SyncRun;
          const { progress, stats, status } = run;
          if (progress && (progress.completed !== undefined || progress.total !== undefined)) {
            setSyncProgress({ completed: progress.completed, total: progress.total, status });
            setLastSyncSummary(`${status === 'running' ? 'Running' : status}: ${progress.completed ?? 0}/${progress.total ?? 0}`);
          } else {
            setLastSyncSummary(`${status}`);
          }
          if (status === 'succeeded') {
            const dur = Date.now() - start;
            setLastSyncSummary(`Synced: pages=${stats?.pagesVisited ?? 0}, files=${stats?.filesImported ?? 0}, intents=${stats?.intentsGenerated ?? 0}, ${dur}ms`);
            await fetchLinks();
            await fetchIndexIntents();
            setSyncProgress(null);
            setSyncingLinks(false);
            notifySuccess('Links synced', `Files ${stats?.filesImported ?? 0}, intents ${stats?.intentsGenerated ?? 0}`);
            return;
          }
          if (status === 'failed') {
            setLastSyncSummary(`Sync failed`);
            setSyncProgress(null);
            setSyncingLinks(false);
            notifyError('Links sync failed');
            return;
          }
        } catch (err) {
          console.error('Polling error:', err);
        }
        setTimeout(poll, 1000);
      };
      poll();
    } catch (e) {
      console.error('Error syncing links:', e);
      setSyncingLinks(false);
      notifyError('Links sync error');
    }
  };

  const handleAddIntent = async (intentId: string) => {
    const suggestedIntent = suggestedIntents.find(intent => intent.id === intentId);
    if (suggestedIntent && index) {
      // Open modal immediately with initial payload (no loading state yet)
      setSelectedSuggestedIntent({
        payload: suggestedIntent.payload,
        id: intentId
      });
      setShowCreateIntentModal(true);
    }
  };

  const handleCreateIntent = async (intent: { payload: string; attachments: File[]; isIncognito: boolean; indexIds: string[] }) => {
    const currentIntentId = selectedSuggestedIntent?.id;
    const currentSuggestion = selectedSuggestedIntent?.payload;
    

    
    // Set adding state now that user has actually submitted
    if (currentIntentId) {
      setAddingIntents(prev => new Set([...prev, currentIntentId]));
    }
    
    try {
      // Create the intent and get the created intent data
      const createdIntent = await intentsService.createIntent({
        payload: intent.payload,
        indexIds: intent.indexIds,
        isIncognito: intent.isIncognito
      });
      
      // Clear adding state
      if (currentIntentId) {
        setAddingIntents(prev => {
          const newSet = new Set(prev);
          newSet.delete(currentIntentId);
          return newSet;
        });
      }
      
      // If created intent has user data, append it directly
      // Otherwise, add current user data or refetch to get complete data
      if (createdIntent.user && createdIntent.user.name) {
        setIntents(prev => [...prev, createdIntent]);
              } else {
          // Always fetch full intent data to get proper user object
          try {
            const fullIntent = await intentsService.getIntent(createdIntent.id);
            setIntents(prev => [...prev, fullIntent]);
          } catch (error) {
            console.error('Error fetching full intent data:', error);
            // Use currentUser as absolute fallback
            const intentWithUser: Intent = {
              ...createdIntent,
              user: {
                id: currentUser?.id || '',
                name: currentUser?.email?.toString().split('@')[0] || 'You',
                email: currentUser?.email?.toString() || null,
                avatar: null
              }
            };
            setIntents(prev => [...prev, intentWithUser]);
           }
        }
      
      // Close modal immediately after intent creation
      setShowCreateIntentModal(false);
      setSelectedSuggestedIntent(null);
      
      // Replace the suggestion with a new one (happens in background)
      if (currentIntentId && currentSuggestion && index) {
        setReplacingIntents(prev => new Set([...prev, currentIntentId]));
        
        try {
          const response = await indexesService.replaceSuggestion(index.id, currentSuggestion);
          
          // Update the suggestions list by replacing the current suggestion with the new one
          setSuggestedIntents(prev => prev.map(suggestedIntent => 
            suggestedIntent.id === currentIntentId 
              ? {
                  id: `intent-${Date.now()}`, // Generate new unique ID
                  payload: response.newSuggestion.payload,
                  confidence: response.newSuggestion.confidence
                }
              : suggestedIntent
          ));
        } catch (error) {
          console.error('Error replacing suggestion:', error);
          // If replacement fails, just remove the suggestion
          setSuggestedIntents(prev => prev.filter(suggestedIntent => suggestedIntent.id !== currentIntentId));
        } finally {
          setReplacingIntents(prev => {
            const newSet = new Set(prev);
            newSet.delete(currentIntentId);
            return newSet;
          });
        }
      }
      
      // Stay on the index page instead of redirecting
    } catch (error) {
      console.error('Error creating intent:', error);
      
      // Close modal on error too
      setShowCreateIntentModal(false);
      setSelectedSuggestedIntent(null);
      
      // Clear adding state on error
      if (currentIntentId) {
        setAddingIntents(prev => {
          const newSet = new Set(prev);
          newSet.delete(currentIntentId);
          return newSet;
        });
      }
    }
  };

  // New handler for title editing
  const handleStartTitleEdit = () => {
    if (index) {
      setEditedTitle(index.title);
      setIsEditingTitle(true);
    }
  };

  const handleCancelTitleEdit = () => {
    setIsEditingTitle(false);
    setEditedTitle("");
  };

  const handleSaveTitleEdit = async () => {
    if (!index || !editedTitle.trim()) return;
    
    setIsUpdatingTitle(true);
    try {
      await indexesService.updateIndex(index.id, {
        title: editedTitle.trim()
      });
      // Refetch the complete index data to ensure we have all files
      const updatedIndex = await indexesService.getIndex(resolvedParams.id);
      setIndex(updatedIndex || null);
      setIsEditingTitle(false);
      setEditedTitle("");
    } catch (error) {
      console.error('Error updating index title:', error);
    } finally {
      setIsUpdatingTitle(false);
    }
  };

  // New handler for delete index
  const handleDeleteIndex = async () => {
    if (!index) return;
    
    setIsDeleting(true);
    try {
      await indexesService.deleteIndex(index.id);
      router.push('/indexes');
    } catch (error) {
      console.error('Error deleting index:', error);
      setIsDeleting(false);
    }
  };

  // Handler for removing intent from index
  const handleRemoveIntent = async (intentId: string) => {
    if (!index) return;
    
    setRemovingIntents(prev => new Set([...prev, intentId]));
    try {
      await intentsService.removeIntentFromIndex(index.id, intentId);
      // Refresh the intents list
      fetchIndexIntents();
    } catch (error) {
      console.error('Error removing intent from index:', error);
    } finally {
      setRemovingIntents(prev => {
        const newSet = new Set(prev);
        newSet.delete(intentId);
        return newSet;
      });
    }
  };



  if (loading) {
    return (
      <ClientLayout>
        <div className="py-8 text-center text-gray-500">Loading...</div>
      </ClientLayout>
    );
  }

  if (!index) {
    return (
      <ClientLayout>
        <div className="py-8 text-center text-gray-500">Index not found</div>
      </ClientLayout>
    );
  }

  return (
    <ClientLayout>
      {/* Main Content */}
      <div className="w-full border border-gray-200 rounded-md px-2 sm:px-4 py-4 sm:py-8" style={{
        backgroundImage: 'url(/grid.png)',
        backgroundColor: 'white',
        backgroundSize: '888px'
      }}>
        <div className="bg-white px-4 pt-1.5 pb-1 border border-black  border border-b-0 inline-block">
          <Link href="/indexes" className="inline-flex items-center text-gray-600 hover:text-gray-900">
            <ArrowLeft className="h-4 w-4 mr-2" />
            <span className="font-ibm-plex-mono text-[14px] text-black font-medium">Back to indexes</span>
          </Link>
        </div>
        <div className="flex flex-col sm:flex-row py-4 px-2 sm:px-4 justify-between items-start sm:items-center border border-black border-b-0 border-b-2 bg-white">
          <div className="flex-1 group">
            <div className="flex items-center gap-2 mb-2">
              {isEditingTitle ? (
                <Input
                  value={editedTitle}
                  onChange={(e) => setEditedTitle(e.target.value)}
                  className="text-2xl font-bold text-gray-900 font-ibm-plex-mono border-none shadow-none pl-0 pr-1 py-0.5 h-auto bg-transparent focus:ring-0 focus:border-none rounded"
                  placeholder="Index title"
                  disabled={isUpdatingTitle}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      handleSaveTitleEdit();
                    } else if (e.key === 'Escape') {
                      handleCancelTitleEdit();
                    }
                  }}
                  onBlur={handleSaveTitleEdit}
                  autoFocus
                />
              ) : (
                <h1 
                  className="text-2xl font-bold text-gray-900 font-ibm-plex-mono cursor-pointer hover:bg-gray-50 pl-0 pr-1 py-0.5 rounded"
                  onClick={handleStartTitleEdit}
                >
                  {index?.title}
                </h1>
              )}
            </div>
            <p className="text-sm text-gray-500 font-ibm-plex-mono">Created {index ? formatDate(index.createdAt) : ''}</p>
          </div>
          <div className="flex gap-2 mt-4 sm:mt-0 flex-wrap sm:flex-nowrap">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowShareSettingsModal(true)}
              className="flex items-center gap-2"
            >
              <Share2 className="h-4 w-4" />
              Share
            </Button>
            {/* Simple options menu */}
            <div className="relative">
              <Button 
                variant="outline" 
                size="sm"
                onClick={() => setShowOptionsMenu(!showOptionsMenu)}
              >
                <MoreVertical className="h-4 w-4" />
              </Button>
              {showOptionsMenu && (
                <div className="absolute right-0 mt-2 w-48 bg-white border border-gray-200 rounded-md shadow-lg z-10">
                  <button
                    onClick={() => {
                      setShowOptionsMenu(false);
                      setShowDeleteDialog(true);
                    }}
                    className="w-full px-4 py-2 text-left text-sm text-red-600 hover:bg-gray-50 flex items-center"
                  >
                    <Trash2 className="h-4 w-4 mr-2" />
                    Delete Index
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Index Links Panel */}
        <div className="mt-4 py-4 px-3 sm:px-6 border border-black border-b-0 border-b-2 bg-white">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-xl mt-2 font-semibold text-gray-900">Index Links</h2>
            <div className="flex items-center gap-2">
              {lastSyncSummary && (
                <span className="text-xs text-gray-500">
                  {lastSyncSummary}
                  {syncProgress && syncProgress.total ? (
                    <>
                      {" "}
                      <span>
                        ({syncProgress.completed ?? 0}/{syncProgress.total})
                      </span>
                    </>
                  ) : null}
                </span>
              )}
              <Button
                variant="outline"
                onClick={handleSyncLinks}
                disabled={syncingLinks}
                className="border-black text-black hover:bg-gray-100"
              >
                {syncingLinks
                  ? (syncProgress?.status === 'queued'
                      ? 'Queued…'
                      : syncProgress?.status === 'running'
                        ? `Running ${syncProgress?.completed ?? 0}/${syncProgress?.total ?? 0}`
                        : 'Syncing…')
                  : 'Sync now'}
              </Button>
            </div>
          </div>

          {syncProgress?.status === 'running' && (syncProgress?.total ?? 0) > 0 && (
            <div className="w-full h-1 bg-gray-200 rounded overflow-hidden mb-3">
              <div
                className="h-full bg-black transition-all"
                style={{ width: `${Math.min(100, Math.round(((syncProgress.completed ?? 0) / (syncProgress.total ?? 0)) * 100))}%` }}
              />
            </div>
          )}

          <div className="flex gap-2 mb-3">
            <input
              type="url"
              value={linkUrl}
              onChange={e => setLinkUrl(e.target.value)}
              placeholder="https://example.com/docs"
              className="flex-1 border border-black px-3 py-2 rounded text-sm text-black font-ibm-plex-mono"
              disabled={addingLink || syncingLinks}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && linkUrl && !addingLink && !syncingLinks) {
                  e.preventDefault();
                  handleAddLink();
                }
              }}
            />
            <Button
              variant="outline"
              onClick={handleAddLink}
              disabled={addingLink || !linkUrl || syncingLinks}
              className="border-black text-black hover:bg-gray-100"
            >
              {addingLink ? 'Adding…' : 'Add link'}
            </Button>
          </div>

          {links.length === 0 ? (
            <p className="text-sm text-gray-500">No links added. Add a URL above and sync to generate intents.</p>
          ) : (
            <ul className="divide-y">
              {links.map(link => (
                <li key={link.id} className="py-2 flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0 mr-3 text-sm text-gray-800 overflow-hidden">
                    <a
                      href={link.url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-black underline-offset-2 hover:underline font-ibm-plex-mono break-words"
                    >
                      {link.url}
                    </a>
                    {/* per-link depth/pages removed; now using global defaults */}
                    {link.lastSyncAt && (
                      <span className="text-gray-500 ml-2">last: {new Date(link.lastSyncAt).toLocaleString()}</span>
                    )}
                    <div className="inline-flex items-center gap-2 ml-2">
                      {link.lastError ? (
                        <span className="px-1.5 py-0.5 text-[10px] font-medium text-red-700 bg-red-100 border border-red-200 rounded-full">Error</span>
                      ) : link.lastSyncAt ? (
                        <span className="px-1.5 py-0.5 text-[10px] font-medium text-green-700 bg-green-100 border border-green-200 rounded-full">Synced</span>
                      ) : (
                        <span className="px-1.5 py-0.5 text-[10px] font-medium text-gray-600 bg-gray-100 border border-gray-200 rounded-full">Never</span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {/* edit controls removed with per-link settings */}
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleDeleteLink(link.id)}
                      className="border-black text-black hover:bg-gray-100"
                    >
                      Delete
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex flex-col sm:flex-col flex-1 mt-4 py-4 px-3 sm:px-6 justify-between items-start sm:items-center border border-black border-b-0 border-b-2 bg-white">
          <div className="space-y-3 w-full">
            <div className="flex justify-between items-center">
              <h2 className="text-xl mt-2 font-semibold text-gray-900">Files</h2>
            </div>
            
            <div className="space-y-2 flex-1">
                {/* Merge uploaded files and uploading files into a single list */}
                {(() => {
                  const uploadedFiles = (index.files || []).map(file => ({ ...file, isUploading: false }));
                  const uploadedFileNames = new Set(uploadedFiles.map(file => file.name));
                  
                  // Only show uploading files that haven't been uploaded yet
                  const uploadingFilesList = Array.from(uploadingFiles)
                    .filter(fileName => !uploadedFileNames.has(fileName))
                    .map(fileName => ({
                      id: `uploading-${fileName}`,
                      name: fileName,
                      size: '',
                      createdAt: new Date().toISOString(),
                      isUploading: true,
                      indexId: index.id
                    }));
                  
                  // Combine and sort: uploading files first (newest first), then uploaded files
                  const allFiles = [...uploadingFilesList, ...uploadedFiles];
                  
                  return allFiles.map((file) => (
                    <div
                      key={file.id}
                      className="flex items-center justify-between px-4 py-1 bg-gray-50 hover:bg-gray-100 transition-colors cursor-pointer"
                    >
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <Button
                            variant="ghost"
                            className="p-0"
                            size="lg"
                            onClick={() => {
                              if (!file.isUploading) {
                                const fileUrl = getIndexFileUrl(file);
                                window.open(fileUrl, '_blank');
                              }
                            }}
                            disabled={file.isUploading}
                          >
                            <h4 className="text-lg font-medium font-ibm-plex-mono text-gray-900 cursor-pointer">
                              {file.name.length > 60
                                ? file.name.slice(0, 12) + '...' + file.name.slice(-38)
                                : file.name}
                            </h4>
                            <ArrowUpRight className="ml-1 h-4 w-4" />
                          </Button>
                        </div>
                        <p className={`text-sm ${file.isUploading ? 'text-gray-400' : 'text-gray-500'}`}>
                          {file.isUploading ? 'Uploading...' : `${file.size} • ${formatDate(file.createdAt)}`}
                        </p>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        className={file.isUploading ? "text-gray-400" : "text-red-500 hover:text-red-700"}
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          if (!file.isUploading) {
                            handleFileDelete(file.id);
                          }
                        }}
                        disabled={file.isUploading || (deletingFiles.has(file.id))}
                      >
                        {file.isUploading || deletingFiles.has(file.id) ? (
                          <div className={`h-4 w-4 border-2 ${file.isUploading ? 'border-gray-400' : 'border-red-500'} border-t-transparent rounded-full animate-spin`} />
                        ) : (
                          <Trash2 className="h-4 w-4" />
                        )}
                      </Button>
                    </div>
                  ));
                })()}
            </div>

            {/* Upload Section */}
            <div 
              className={`mt-4 border-2 border-dashed p-6 flex flex-col items-center justify-center transition-colors cursor-pointer ${
                isDragging 
                  ? "border-gray-400 bg-gray-100" 
                  : "border-gray-200 bg-gray-50 hover:bg-gray-100"
              }`}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
            >
              <input
                type="file"
                className="hidden"
                id="file-upload"
                multiple
                onChange={async (e) => {
                  const files = Array.from(e.target.files || []);
                  if (index && files.length > 0) {
                    const wasEmpty = !index.files || index.files.length === 0;
                    
                    // Add files to uploading state
                    const newUploadingFiles = new Set(uploadingFiles);
                    files.forEach(file => newUploadingFiles.add(file.name));
                    setUploadingFiles(newUploadingFiles);

                    try {
                      await Promise.all(files.map(file => indexesService.uploadFile(index.id, file)));
                      const updatedIndex = await indexesService.getIndex(resolvedParams.id);
                      setIndex(updatedIndex || null);
                      
                      // Auto-create intents if this was the first file upload
                      if (wasEmpty) {
                        await handleAutoIntentCreation(index.id);
                      }
                    } catch (error) {
                      console.error('Error uploading files:', error);
                    } finally {
                      // Clear uploading state
                      setUploadingFiles(new Set());
                    }
                  }
                }}
              />
              <label
                htmlFor="file-upload"
                className="flex flex-col items-center cursor-pointer w-full"
              >
                <Upload className={`h-6 w-6 mb-2 ${isDragging ? 'text-gray-600' : 'text-gray-400'}`} />
                <p className="text-sm font-medium text-gray-900">Upload Files</p>
                <p className="text-xs text-gray-500 mt-1">Drag and drop your files here or click to browse</p>
              </label>
            </div>
          </div>
        </div>

        {/* Intents Section */}
        <div ref={intentsRef} className="flex flex-col sm:flex-col flex-1 mt-4 py-4 px-3 sm:px-6 justify-between items-start sm:items-center border border-black border-b-0 border-b-2 bg-white">
          <div className="space-y-3 w-full">
            <div className="flex justify-between items-center">
              <h2 className="text-xl mt-2 font-semibold text-gray-900">Intents</h2>
            </div>
            
            <div className="space-y-1 flex-1">
              {loadingIndexIntents || uploadingFiles.size > 0 || isAutoCreatingIntents ? (
                <div className={`text-center py-8 text-gray-500 ${isAutoCreatingIntents ? 'flex flex-col items-center justify-center min-h-[200px]' : ''}`}>
                  {isAutoCreatingIntents ? (
                    <>
                      <div className="w-8 h-8 border-2 border-gray-400 border-t-transparent rounded-full animate-spin mb-4"></div>
                      <div className="text-lg font-medium">Creating your first intents...</div>
                      <div className="text-sm text-gray-400 mt-2">Analyzing your files and generating relevant intents</div>
                    </>
                  ) : uploadingFiles.size > 0 ? (
                    "Processing files and generating intents..."
                  ) : (
                    "Loading intents..."
                  )}
                </div>
              ) : intents.length > 0 ? (
                intents.map((intent) => (
                  <div
                    key={intent.id}
                    className="flex items-center justify-between p-3 px-4 bg-gray-50 hover:bg-gray-100 transition-colors"
                  >
                    <div className="flex-1">
                      <Link
                        href={`/intents/${intent.id}`}
                        className="flex items-center gap-2 mb-1"
                      >
                        <h4 className="text-sm font-ibm-plex-mono font-medium text-gray-900">{intent.summary}</h4>
                        <ArrowUpRight className="h-4 w-4" />
                      </Link>
                      <div className="flex items-center gap-2">
                        <span className="text-sm text-gray-500">{intent.user?.name || 'Unknown User'}</span>
                        <span className="text-sm text-gray-400">•</span>
                        <span className="text-sm text-gray-500">{formatDate(intent.createdAt)}</span>
                      </div>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        handleRemoveIntent(intent.id);
                      }}
                      disabled={removingIntents.has(intent.id)}
                    >
                      {removingIntents.has(intent.id) ? (
                        <div className="h-4 w-4 border-2 border-red-500 border-t-transparent rounded-full animate-spin" />
                      ) : (
                        <div>
                          Remove
                        </div>
                      )}
                    </Button>
                  </div>
                ))
              ) : (
                <div className="text-center py-4 text-gray-600">No intents found for this index</div>
              )}
            </div>
          </div>
        </div>

        { ((index.files && index.files.length > 0) || uploadingFiles.size > 0) && 
        <div className="flex flex-col sm:flex-col flex-1 mt-4 py-4 px-3 sm:px-6 justify-between items-start sm:items-center border border-black border-b-0 border-b-2 bg-white">
          <div className="space-y-6 w-full">
            <div className="flex justify-between items-center">
              <h2 className="text-xl mt-2 font-semibold text-gray-900">Suggested Intents</h2>
            </div>
            
            <div className="space-y-2 flex-1">
              {loadingIntents || uploadingFiles.size > 0 || isAutoCreatingIntents ? (
                <div className={`text-center py-4 text-gray-500 ${isAutoCreatingIntents ? 'flex flex-col items-center justify-center min-h-[150px]' : ''}`}>
                  {isAutoCreatingIntents ? (
                    <>
                      <div className="w-6 h-6 border-2 border-gray-400 border-t-transparent rounded-full animate-spin mb-3"></div>
                      <div className="text-md font-medium">Preparing suggestions...</div>
                    </>
                  ) : uploadingFiles.size > 0 ? (
                    "Processing files and generating suggestions..."
                  ) : (
                    "Loading suggested intents..."
                  )}
                </div>
              ) : suggestedIntents.length > 0 ? (
                suggestedIntents.map((intent) => (
                  <div key={intent.id} className="flex items-center justify-between py-3 px-4 bg-gray-50 hover:bg-gray-100 transition-colors">
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        {addingIntents.has(intent.id) || replacingIntents.has(intent.id) ? (
                          // Ghost/skeleton loading state
                          <div className="space-y-2 w-full">
                            <div className="h-4 bg-gray-200 rounded animate-pulse w-3/4"></div>
                            <div className="h-3 bg-gray-200 rounded animate-pulse w-1/2"></div>
                          </div>
                        ) : (
                          <h4 className="text-sm font-ibm-plex-mono font-medium text-gray-900">{intent.payload}</h4>
                        )}
                      </div>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      className="ml-4"
                                              onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          handleAddIntent(intent.id);
                        }}
                      disabled={addingIntents.has(intent.id) || replacingIntents.has(intent.id)}
                    >
                      {addingIntents.has(intent.id) || replacingIntents.has(intent.id) ? (
                        <div className="h-4 w-4 border-2 border-gray-500 border-t-transparent rounded-full animate-spin" />
                      ) : (
                        "Add"
                      )}
                    </Button>
                  </div>
                ))
              ) : (
                <div className="text-center py-4 text-gray-500">No suggested intents available</div>
              )}
            </div>
          </div>
        </div> }

      </div>

      {/* Click outside to close options menu */}
      {showOptionsMenu && (
        <div
          className="fixed inset-0 z-5"
          onClick={() => setShowOptionsMenu(false)}
        />
      )}

      {/* Modals */}
      <ShareSettingsModal
        open={showShareSettingsModal}
        onOpenChange={setShowShareSettingsModal}
        index={index}
        onIndexUpdate={(updatedIndex) => setIndex(updatedIndex)}
      />
      <CreateIntentModal 
        open={showCreateIntentModal}
        onOpenChange={setShowCreateIntentModal}
        onSubmit={handleCreateIntent}
        initialPayload={selectedSuggestedIntent?.payload || ''}
        indexId={index?.id}
      />
      <ConfigureModal 
        open={showConfigDialog}
        onOpenChange={setShowConfigDialog}
      />
      
      {/* Delete Confirmation Modal */}
      <DeleteIndexModal
        open={showDeleteDialog}
        onOpenChange={setShowDeleteDialog}
        index={index}
        onDeleteIndex={handleDeleteIndex}
        isDeleting={isDeleting}
      />
    </ClientLayout>
  );
} 
