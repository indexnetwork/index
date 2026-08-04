import { useState, useCallback, useRef } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { X, Globe, Lock, Camera } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { validateFiles } from '@/lib/file-validation';
import NetworkAvatar from '@/components/IndexAvatar';
import { log } from '@/lib/logger';

const logger = log.ui.from('CreateIndexModal');

interface CreateNetworkModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (index: {
    name: string;
    prompt?: string;
    imageUrl?: string | null;
    joinPolicy?: 'anyone' | 'invite_only';
  }) => Promise<void>;
  uploadIndexImage?: (file: File) => Promise<string>;
}

export default function CreateNetworkModal({ open, onOpenChange, onSubmit, uploadIndexImage }: CreateNetworkModalProps) {
  const [name, setName] = useState('');
  const [prompt, setPrompt] = useState('');
  const [joinPolicy, setJoinPolicy] = useState<'anyone' | 'invite_only'>('invite_only');
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [imageError, setImageError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleImageChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const validation = validateFiles([file], 'avatar');
      if (!validation.isValid) {
        setImageError(validation.message || 'Invalid file');
        e.target.value = '';
        return;
      }
      setImageError(null);
      setImageFile(file);
      const reader = new FileReader();
      reader.onload = (ev) => setImagePreview(ev.target?.result as string);
      reader.readAsDataURL(file);
    }
  }, []);

  const handleRemoveImage = useCallback(() => {
    setImageFile(null);
    setImagePreview(null);
    setImageError(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, []);

  const resetForm = useCallback(() => {
    setName('');
    setPrompt('');
    setJoinPolicy('invite_only');
    handleRemoveImage();
  }, [handleRemoveImage]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || isSubmitting) return;

    setIsSubmitting(true);
    try {
      let imageUrl: string | null = null;
      if (imageFile && uploadIndexImage) {
        imageUrl = await uploadIndexImage(imageFile);
      }
      const submitData: Parameters<typeof onSubmit>[0] = {
        name: name.trim(),
        prompt: prompt.trim() || undefined,
        imageUrl,
        joinPolicy,
      };
      await onSubmit(submitData);
      resetForm();
      onOpenChange(false);
    } catch (error) {
      logger.error('Error creating index', { error });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleOpenChange = (open: boolean) => {
    if (!isSubmitting) {
      if (!open) resetForm();
      onOpenChange(open);
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={handleOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/50 z-[100]" />
        <Dialog.Content className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-white rounded-sm shadow-lg w-full max-w-md z-[100] focus:outline-none">
          <div className="p-6">
            <div className="flex items-center justify-between mb-6">
              <Dialog.Title className="text-lg font-bold text-black">
                Create Network
              </Dialog.Title>
              <Dialog.Close className="p-1 rounded-sm hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors">
                <X className="h-4 w-4" />
              </Dialog.Close>
            </div>

            <form onSubmit={handleSubmit} className="space-y-5">
              {/* Identity header: circle image left, name/placeholder right */}
              <div className="flex items-center gap-5">
                <button
                  type="button"
                  aria-label="Upload network image"
                  onClick={() => uploadIndexImage && fileInputRef.current?.click()}
                  disabled={isSubmitting || !uploadIndexImage}
                  className="relative flex-shrink-0 group cursor-pointer disabled:cursor-not-allowed"
                >
                  <div className="w-[72px] h-[72px] rounded-full overflow-hidden">
                    {imagePreview ? (
                      <img src={imagePreview} alt="Preview" width={72} height={72} loading="lazy" className="w-full h-full object-cover" />
                    ) : (
                      <NetworkAvatar title={name || 'Network name'} size={72} rounded="full" />
                    )}
                  </div>
                  <div className="absolute inset-0 rounded-full bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity duration-150 flex items-center justify-center">
                    <Camera className="w-4 h-4 text-white" />
                  </div>
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleImageChange}
                  className="hidden"
                />
                <div className="min-w-0 flex-1">
                  <div className="font-semibold text-gray-900 font-ibm-plex-mono truncate leading-tight">
                    {name.trim() || "Network name"}
                  </div>
                  {imagePreview && (
                    <button
                      type="button"
                      onClick={handleRemoveImage}
                      disabled={isSubmitting}
                      className="text-sm text-red-600 hover:text-red-700 font-medium disabled:opacity-50 mt-1"
                    >
                      Remove image
                    </button>
                  )}
                  {imageError && (
                    <p className="text-sm text-red-600 font-medium mt-1">{imageError}</p>
                  )}
                </div>
              </div>

              {/* Name field at bottom */}
              <div>
                <label htmlFor="name" className="text-md font-medium font-ibm-plex-mono text-black">
                  <div className="mb-2">Name *</div>
                </label>
                <Input
                  id="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Network name"
                  disabled={isSubmitting}
                  autoFocus
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-900 mb-2">
                  Description <span className="text-gray-400 font-normal">(optional)</span>
                </label>
                <Textarea
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  placeholder="What people can share in this network..."
                  rows={3}
                  disabled={isSubmitting}
                  className="resize-none"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-900 mb-2">Access</label>
                <div className="space-y-2">
                  {([
                    { key: 'public', icon: Globe, label: 'Public', desc: 'Anyone can discover and join' },
                    { key: 'private', icon: Lock, label: 'Private', desc: 'Only people with invitation link' },
                  ] as const).map(({ key, icon: Icon, label, desc }) => {
                    const selected = key === 'public' ? joinPolicy === 'anyone' : joinPolicy === 'invite_only';
                    return (
                      <button
                        key={key}
                        type="button"
                        onClick={() => setJoinPolicy(key === 'public' ? 'anyone' : 'invite_only')}
                        disabled={isSubmitting}
                        className={`w-full flex items-center gap-3 p-3 border rounded-sm text-left transition-colors ${
                          selected ? 'border-black bg-gray-50' : 'border-gray-200 hover:border-gray-300'
                        } ${isSubmitting ? 'opacity-50 cursor-not-allowed' : ''}`}
                      >
                        <Icon className={`h-4 w-4 ${selected ? 'text-black' : 'text-gray-400'}`} />
                        <div>
                          <p className="text-sm font-medium text-black">{label}</p>
                          <p className="text-xs text-gray-500">{desc}</p>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="flex justify-end gap-3 pt-2">
                <Button type="button" variant="outline" onClick={() => handleOpenChange(false)} disabled={isSubmitting}>
                  Cancel
                </Button>
                <Button type="submit" disabled={!name.trim() || isSubmitting}>
                  {isSubmitting ? 'Creating...' : 'Create'}
                </Button>
              </div>
            </form>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
