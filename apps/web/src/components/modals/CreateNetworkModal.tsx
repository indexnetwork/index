import { useState, useCallback, useEffect, useRef } from 'react';
import { validateFiles } from '@/lib/file-validation';
import NetworkAvatar from '@/components/NetworkAvatar';
import ChoiceCard from '@/components/ui/ChoiceCard';
import { log } from '@/lib/logger';

const logger = log.ui.from('CreateNetworkModal');

interface CreateNetworkModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (network: {
    name: string;
    prompt?: string;
    imageUrl?: string | null;
    joinPolicy?: 'anyone' | 'invite_only';
  }) => Promise<void>;
  uploadNetworkImage?: (file: File) => Promise<string>;
}

export default function CreateNetworkModal({ open, onOpenChange, onSubmit, uploadNetworkImage }: CreateNetworkModalProps) {
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
      if (imageFile && uploadNetworkImage) {
        imageUrl = await uploadNetworkImage(imageFile);
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
      logger.error('Error creating network', { error });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleOpenChange = useCallback((next: boolean) => {
    if (isSubmitting) return;
    if (!next) resetForm();
    onOpenChange(next);
  }, [isSubmitting, onOpenChange, resetForm]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      handleOpenChange(false);
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [open, handleOpenChange]);

  if (!open) return null;

  return (
    <div className="ca-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) handleOpenChange(false); }}>
      <div className="ca-panel nn-panel" role="dialog" aria-modal="true" aria-labelledby="create-network-title">
        <header className="ca-head">
          <h2 id="create-network-title">New network</h2>
        </header>
        <p className="ca-lede">
          A network is a group that shares intents. If you run a community, event, or team, create one here, then invite your members so their intents can find each other.
        </p>
        <form className="nn-form" onSubmit={handleSubmit}>
          <div className="nn-photo">
            <button
              type="button"
              className="pl-plain-btn nn-photo-pick"
              aria-label={imagePreview ? "change picture" : "add a picture"}
              title={imagePreview ? "change picture" : "add a picture"}
              onClick={() => fileInputRef.current?.click()}
              disabled={isSubmitting || !uploadNetworkImage}
            >
              <NetworkAvatar title={name || "network"} imageUrl={imagePreview} size={54} />
              <span className="nn-photo-pen" aria-hidden>✎</span>
            </button>
            <div className="nn-photo-text">
              <span>{imagePreview ? "picture" : "picture, optional"}</span>
              {imagePreview && <button type="button" className="pl-plain-btn st-link" onClick={handleRemoveImage} disabled={isSubmitting}>remove</button>}
            </div>
          </div>
          <input ref={fileInputRef} type="file" accept="image/*" onChange={handleImageChange} hidden />
          {imageError && <p className="st-error">{imageError}</p>}

          <div>
            <div className="st-label">name<span className="st-req">*</span></div>
            <div className="st-well">
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="network name" aria-label="name" disabled={isSubmitting} autoFocus required />
            </div>
          </div>
          <div>
            <div className="st-label">description</div>
            <div className="st-well">
              <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="what it's for, who's in it" aria-label="description" rows={3} disabled={isSubmitting} />
            </div>
          </div>
          <div>
            <div className="st-label">access</div>
            <div className="nn-access">
              <ChoiceCard title="Public" sub="Anyone can join" selected={joinPolicy === "anyone"} onClick={() => setJoinPolicy("anyone")} />
              <ChoiceCard title="Private" sub="Invite only" selected={joinPolicy === "invite_only"} onClick={() => setJoinPolicy("invite_only")} />
            </div>
          </div>
          <div className="nn-actions">
            <button type="button" className="wb-btn" onClick={() => handleOpenChange(false)} disabled={isSubmitting}>cancel</button>
            <button aria-busy={isSubmitting} type="submit" className="wb-btn primary" disabled={!name.trim() || isSubmitting}>{isSubmitting ? "creating" : "create"}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
