import { useState, useEffect, useCallback, useRef } from 'react';
import * as AlertDialog from '@radix-ui/react-alert-dialog';
import { Camera, ChevronRight, ChevronDown, Trash2 } from 'lucide-react';

import { Network } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { validateFiles } from '@/lib/file-validation';
import NetworkAvatar, { resolveNetworkImageSrc } from '@/components/IndexAvatar';
import { log } from '@/lib/logger';

const logger = log.ui.from('SettingsTab');

interface SettingsTabProps {
  network: Network;
  networkId: string;
  updateNetwork: (id: string, data: { title?: string; prompt?: string | null; imageUrl?: string | null; metadata?: Record<string, unknown> }) => Promise<Network>;
  uploadImage: (file: File) => Promise<string>;
  onUpdated: (network: Network) => void;
  onDeleted?: () => void;
  deleteNetwork: (id: string) => Promise<void>;
  onRemoved: (id: string) => void;
  success: (msg: string) => void;
  error: (msg: string) => void;
}

export default function SettingsTab({
  network,
  networkId,
  updateNetwork,
  uploadImage,
  onUpdated,
  onDeleted,
  deleteNetwork,
  onRemoved,
  success,
  error,
}: SettingsTabProps) {
  const [title, setTitle] = useState(network.title || '');
  const [prompt, setPrompt] = useState(network.prompt || '');
  const [imageUrl, setImageUrl] = useState<string | null>(network.imageUrl ?? null);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [removeImageRequested, setRemoveImageRequested] = useState(false);
  const [originalTitle, setOriginalTitle] = useState(network.title || '');
  const [originalPrompt, setOriginalPrompt] = useState(network.prompt || '');
  const [originalImageUrl, setOriginalImageUrl] = useState<string | null>(network.imageUrl ?? null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const [isSavingSettings, setIsSavingSettings] = useState(false);
  const [isDeletingIndex, setIsDeletingIndex] = useState(false);
  const [showDeleteConfirmation, setShowDeleteConfirmation] = useState(false);
  const [deleteConfirmationText, setDeleteConfirmationText] = useState('');
  const [isDangerZoneExpanded, setIsDangerZoneExpanded] = useState(false);

  /* eslint-disable react-hooks/set-state-in-effect -- syncs local form state from prop changes */
  useEffect(() => {
    setTitle(network.title);
    setPrompt(network.prompt || '');
    setImageUrl(network.imageUrl ?? null);
    setOriginalTitle(network.title);
    setOriginalPrompt(network.prompt || '');
    setOriginalImageUrl(network.imageUrl ?? null);
    setImageFile(null);
    setImagePreview(null);
    setRemoveImageRequested(false);
    setDeleteConfirmationText('');
    setIsDangerZoneExpanded(false);
  }, [network.id, network.title, network.prompt, network.imageUrl]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const handleImageChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const validation = validateFiles([file], 'avatar');
      if (!validation.isValid) {
        error(validation.message || 'Invalid image file');
        e.target.value = '';
        return;
      }
      setImageFile(file);
      setRemoveImageRequested(false);
      const reader = new FileReader();
      reader.onload = (ev) => setImagePreview(ev.target?.result as string);
      reader.readAsDataURL(file);
    }
  }, [error]);

  const handleRemoveImage = useCallback(() => {
    setImageFile(null);
    setImagePreview(null);
    setRemoveImageRequested(true);
    if (imageInputRef.current) imageInputRef.current.value = '';
  }, []);

  const handleSaveSettings = async () => {
    if (!title.trim()) {
      error('Title cannot be empty');
      return;
    }
    try {
      setIsSavingSettings(true);
      let finalImageUrl: string | null = imageUrl;
      if (imageFile) {
        finalImageUrl = await uploadImage(imageFile);
      } else if (removeImageRequested) {
        finalImageUrl = null;
      }
      const updatedIndex = await updateNetwork(networkId, {
        title: title.trim(), prompt: prompt.trim() || null, imageUrl: finalImageUrl,
      });
      setOriginalTitle(title);
      setOriginalPrompt(prompt);
      setOriginalImageUrl(finalImageUrl);
      setImageFile(null);
      setImagePreview(null);
      setRemoveImageRequested(false);
      setImageUrl(finalImageUrl);
      onUpdated(updatedIndex);
      success('Settings updated');
    } catch (err) {
      logger.error('Error updating index', { error: err });
      error('Failed to update settings');
    } finally {
      setIsSavingSettings(false);
    }
  };

  const handleDeleteIndex = async () => {
    try {
      setIsDeletingIndex(true);
      await deleteNetwork(networkId);
      onRemoved(networkId);
      success('Network deleted');
      setShowDeleteConfirmation(false);
      onDeleted?.();
    } catch (err) {
      logger.error('Error deleting index', { error: err });
      error('Failed to delete network');
    } finally {
      setIsDeletingIndex(false);
    }
  };

  const displayImageUrl = imagePreview ? imagePreview : (removeImageRequested ? null : imageUrl);
  const hasImageChanged = (imageFile !== null) || removeImageRequested || (imageUrl !== originalImageUrl && !imageFile && !removeImageRequested);
  const hasSettingsChanged = title !== originalTitle || prompt !== originalPrompt || hasImageChanged;
  const isDeleteConfirmationValid = deleteConfirmationText === network.title;

  return (
    <>
      <div className="space-y-6">
        {/* Identity header: circle image left, title/placeholder right */}
        <div className="flex items-center gap-5">
          <button
            type="button"
            onClick={() => imageInputRef.current?.click()}
            disabled={isSavingSettings}
            className="relative flex-shrink-0 group cursor-pointer disabled:cursor-not-allowed"
          >
            <div className="w-[72px] h-[72px] rounded-full overflow-hidden">
              {displayImageUrl ? (
                <img src={resolveNetworkImageSrc(displayImageUrl)} alt="Network" width={72} height={72} loading="lazy" className="w-full h-full object-cover" />
              ) : (
                <NetworkAvatar id={networkId} title={title || network.title} size={72} rounded="full" />
              )}
            </div>
            <div className="absolute inset-0 rounded-full bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity duration-150 flex items-center justify-center">
              <Camera className="w-4 h-4 text-white" />
            </div>
          </button>
          <input
            ref={imageInputRef}
            type="file"
            accept="image/*"
            onChange={handleImageChange}
            className="hidden"
          />
          {displayImageUrl && (
            <button
              type="button"
              onClick={handleRemoveImage}
              disabled={isSavingSettings}
              className="text-sm text-red-600 hover:text-red-700 font-medium disabled:opacity-50"
            >
              Remove image
            </button>
          )}
        </div>

        {/* Title field */}
        <div>
          <label htmlFor="title" className="text-sm font-medium font-ibm-plex-mono text-gray-700 block mb-1.5">
            Title
          </label>
          <Input id="title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Network title" />
        </div>
        <div>
          <label className="block text-sm font-medium font-ibm-plex-mono text-gray-700 mb-1.5">Prompt</label>
          <Textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="What people can share in this network..." className="min-h-[100px]" rows={4} />
          <p className="text-xs text-gray-400 mt-1.5">Guides what kind of signals people can share.</p>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={() => { setTitle(originalTitle); setPrompt(originalPrompt); setImageUrl(originalImageUrl); setImageFile(null); setImagePreview(null); setRemoveImageRequested(false); if (imageInputRef.current) imageInputRef.current.value = ''; }} disabled={isSavingSettings || !hasSettingsChanged}>
            Cancel
          </Button>
          <Button size="sm" onClick={handleSaveSettings} disabled={isSavingSettings || !hasSettingsChanged || !title.trim()}>
            {isSavingSettings ? 'Saving...' : 'Save'}
          </Button>
        </div>

        {/* Danger zone */}
        {(
          <div className="pt-6 border-t border-gray-100">
            <button
              onClick={() => setIsDangerZoneExpanded(!isDangerZoneExpanded)}
              className="flex items-center gap-2 text-sm text-red-500 hover:text-red-600 transition-colors"
            >
              {isDangerZoneExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
              Danger Zone
            </button>
            {isDangerZoneExpanded && (
              <div className="mt-3 flex items-center justify-between p-3 border border-red-100 rounded-sm bg-red-50">
                <div>
                  <p className="text-sm font-medium text-red-800">Delete this network</p>
                  <p className="text-xs text-red-500 mt-0.5">This action cannot be undone.</p>
                </div>
                <Button variant="outline" size="sm" onClick={() => setShowDeleteConfirmation(true)} className="border-red-200 text-red-600 hover:bg-red-100">
                  <Trash2 className="h-4 w-4 mr-1" /> Delete
                </Button>
              </div>
            )}
          </div>
        )}
      </div>

      <AlertDialog.Root open={showDeleteConfirmation} onOpenChange={setShowDeleteConfirmation}>
        <AlertDialog.Portal>
          <AlertDialog.Overlay className="fixed inset-0 bg-black/50 z-[100]" />
          <AlertDialog.Content className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-white rounded-sm shadow-lg p-6 w-full max-w-md z-[100] focus:outline-none">
            <AlertDialog.Title className="text-lg font-bold text-gray-900 mb-4">Delete &apos;{network.title}&apos;</AlertDialog.Title>
            <AlertDialog.Description className="text-sm text-gray-600 mb-4">This action cannot be undone. Type the network name to confirm.</AlertDialog.Description>
            <Input value={deleteConfirmationText} onChange={(e) => setDeleteConfirmationText(e.target.value)} placeholder={network.title} className="mb-4" />
            <div className="flex justify-end gap-3">
              <AlertDialog.Cancel asChild><Button variant="outline">Cancel</Button></AlertDialog.Cancel>
              <Button onClick={handleDeleteIndex} disabled={isDeletingIndex || !isDeleteConfirmationValid} className="bg-red-600 hover:bg-red-700 text-white">
                {isDeletingIndex ? 'Deleting...' : 'Delete'}
              </Button>
            </div>
          </AlertDialog.Content>
        </AlertDialog.Portal>
      </AlertDialog.Root>
    </>
  );
}
