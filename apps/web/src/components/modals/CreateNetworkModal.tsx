import { useState, useCallback, useRef } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { validateFiles } from '@/lib/file-validation';
import NetworkAvatar from '@/components/NetworkAvatar';
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

  const handleOpenChange = (open: boolean) => {
    if (!isSubmitting) {
      if (!open) resetForm();
      onOpenChange(open);
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={handleOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[100]" style={{ background: "rgba(0,85,170,0.28)" }} />
        <Dialog.Content className="amiga-window fixed left-1/2 top-1/2 z-[100] w-full max-w-md -translate-x-1/2 -translate-y-1/2 focus:outline-none">
          <div className="mac-titlebar">
            <Dialog.Close className="mac-close" aria-label="close" />
            <span className="mac-title"><span className="t">new network</span></span>
          </div>
          <div className="wb-body" style={{ padding: 18 }}>
            <Dialog.Title style={{ margin: "0 0 10px", fontFamily: "var(--mac-sans)", fontSize: 13, lineHeight: 1.45 }}>
              a network is a group that shares signals. if you run a community, event, or team, create one here, then invite your members so their signals can find each other.
            </Dialog.Title>
            <form onSubmit={handleSubmit} style={{ display: "grid", gap: 12 }}>
              <button type="button" onClick={() => uploadNetworkImage && fileInputRef.current?.click()} disabled={isSubmitting || !uploadNetworkImage} style={{ display: "flex", gap: 12, alignItems: "center", background: "none", border: "none", padding: 0, textAlign: "left" }}>
                <NetworkAvatar title={name || "network name"} imageUrl={imagePreview} size={48} />
                <span style={{ fontFamily: "var(--mac-mono)", fontSize: 11 }}>{imagePreview ? "picture" : "picture optional"}</span>
              </button>
              <input ref={fileInputRef} type="file" accept="image/*" onChange={handleImageChange} className="hidden" />
              {imagePreview && <button type="button" className="wb-btn small" onClick={handleRemoveImage} disabled={isSubmitting}>remove image</button>}
              {imageError && <p style={{ margin: 0, fontFamily: "var(--mac-mono)", fontSize: 12, color: "var(--ink-warn)" }}>{imageError}</p>}
              <label style={{ fontFamily: "var(--mac-mono)", fontSize: 11 }}>name
                <input id="name" value={name} onChange={(e) => setName(e.target.value)} placeholder="network name" disabled={isSubmitting} autoFocus required style={{ display: "block", width: "100%", marginTop: 4, border: "1px solid #000", padding: "8px 10px", fontFamily: "var(--mac-sans)", fontSize: 13 }} />
              </label>
              <label style={{ fontFamily: "var(--mac-mono)", fontSize: 11 }}>description
                <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="optional" rows={3} disabled={isSubmitting} style={{ display: "block", width: "100%", marginTop: 4, border: "1px solid #000", padding: "8px 10px", fontFamily: "var(--mac-sans)", fontSize: 13 }} />
              </label>
              <div>
                <p style={{ margin: "0 0 6px", fontFamily: "var(--mac-mono)", fontSize: 11 }}>access</p>
                <div style={{ display: "flex", gap: 8 }}>
                  <button type="button" className={`wb-btn small${joinPolicy === "anyone" ? " primary" : ""}`} onClick={() => setJoinPolicy("anyone")}>public</button>
                  <button type="button" className={`wb-btn small${joinPolicy === "invite_only" ? " primary" : ""}`} onClick={() => setJoinPolicy("invite_only")}>private</button>
                </div>
              </div>
              <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
                <button type="button" className="wb-btn" onClick={() => handleOpenChange(false)} disabled={isSubmitting}>cancel</button>
                <button type="submit" className="wb-btn primary" disabled={!name.trim() || isSubmitting}>{isSubmitting ? "creating…" : "create"}</button>
              </div>
            </form>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
