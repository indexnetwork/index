import { useState, useCallback, useEffect, useRef } from 'react';
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

  const field = { display: "block", width: "100%", marginTop: 4, border: "1px solid #000", padding: "8px 10px", fontFamily: "var(--mac-sans)", fontSize: 13 } as const;

  return (
    <div
      style={{ position: "fixed", inset: 0, zIndex: 110, display: "grid", placeItems: "center", background: "rgba(0,85,170,0.28)", padding: 24 }}
      onClick={() => handleOpenChange(false)}
    >
      <div
        className="amiga-window"
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-network-title"
        style={{ width: 480, maxWidth: "100%" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mac-titlebar">
          <span className="mac-close" role="button" tabIndex={0} aria-label="close" onClick={() => handleOpenChange(false)} />
          <span className="mac-title"><span className="t">new network</span></span>
        </div>
        <div className="wb-body mac-scroll" style={{ padding: 18, gap: 12, maxHeight: "70vh", overflowY: "auto" }}>
          <p id="create-network-title" style={{ margin: 0, fontFamily: "var(--mac-sans)", fontSize: 13, lineHeight: 1.45 }}>
            a network is a group that shares signals. if you run a community, event, or team, create one here, then invite your members so their signals can find each other.
          </p>
          <form onSubmit={handleSubmit} style={{ display: "grid", gap: 12 }}>
            <button type="button" onClick={() => uploadNetworkImage && fileInputRef.current?.click()} disabled={isSubmitting || !uploadNetworkImage} style={{ display: "flex", gap: 12, alignItems: "center", background: "none", border: "none", padding: 0, textAlign: "left" }}>
              <NetworkAvatar title={name || "network name"} imageUrl={imagePreview} size={48} />
              <span style={{ fontFamily: "var(--mac-mono)", fontSize: 11 }}>{imagePreview ? "picture" : "picture optional"}</span>
            </button>
            <input ref={fileInputRef} type="file" accept="image/*" onChange={handleImageChange} style={{ display: "none" }} />
            {imagePreview && <button type="button" className="wb-btn small" onClick={handleRemoveImage} disabled={isSubmitting}>remove image</button>}
            {imageError && <p style={{ margin: 0, fontFamily: "var(--mac-mono)", fontSize: 12, color: "var(--ink-warn)" }}>{imageError}</p>}
            <label style={{ fontFamily: "var(--mac-mono)", fontSize: 11 }}>name
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="network name" disabled={isSubmitting} autoFocus required style={field} />
            </label>
            <label style={{ fontFamily: "var(--mac-mono)", fontSize: 11 }}>description
              <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="optional" rows={3} disabled={isSubmitting} style={field} />
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
      </div>
    </div>
  );
}
