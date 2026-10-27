import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router';

import { Network } from '@/lib/types';
import { validateFiles } from '@/lib/file-validation';
import { resolveNetworkImageSrc } from '@/lib/network-image';
import { log } from '@/lib/logger';
import { APIError } from '@/lib/api';

const logger = log.ui.from('SettingsTab');
const TILE = ["#FF8A00", "#0055AA", "#C64B8C", "#3E8E7E", "#E8C547", "#7B5EA7"];

interface SettingsTabProps {
  network: Network;
  networkId: string;
  updateNetwork: (id: string, data: { title?: string; key?: string | null; prompt?: string | null; imageUrl?: string | null; metadata?: Record<string, unknown> }) => Promise<Network>;
  uploadImage: (file: File) => Promise<string>;
  onUpdated: (network: Network) => void;
  onDeleted?: () => void;
  deleteNetwork: (id: string) => Promise<void>;
  onRemoved: (id: string) => void;
  success: (msg: string) => void;
  error: (msg: string) => void;
}

function NetworkTile({ name, photo, size }: { name: string; photo?: string | null; size: number }) {
  const [broken, setBroken] = useState(false);
  if (photo && !broken) {
    const src = photo.startsWith("data:") ? photo : resolveNetworkImageSrc(photo);
    return (
      <img src={src} alt="" onError={() => setBroken(true)} style={{ width: size, height: size, objectFit: "cover", display: "block", border: "1px solid #000", filter: "grayscale(1) contrast(1.05)" }} />
    );
  }
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  const cells = [0, 1, 2, 3].map((i) => TILE[(h >>> (i * 3)) % TILE.length]);
  return (
    <span style={{ width: size, height: size, border: "1px solid #000", display: "grid", gridTemplateColumns: "1fr 1fr", gridTemplateRows: "1fr 1fr" }}>
      {cells.map((color, i) => <span key={i} style={{ background: color }} />)}
    </span>
  );
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
  const navigate = useNavigate();
  const [title, setTitle] = useState(network.title || '');
  // The network's index.network/<key> link name, shared with usernames.
  const savedKey = (network as { key?: string | null }).key ?? '';
  const [linkName, setLinkName] = useState(savedKey);
  const [prompt, setPrompt] = useState(network.prompt || '');
  const [imageUrl, setImageUrl] = useState<string | null>(network.imageUrl ?? null);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [removeImageRequested, setRemoveImageRequested] = useState(false);
  const [originalTitle, setOriginalTitle] = useState(network.title || '');
  const [originalPrompt, setOriginalPrompt] = useState(network.prompt || '');
  const [originalImageUrl, setOriginalImageUrl] = useState<string | null>(network.imageUrl ?? null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const [hot, setHot] = useState(false);
  const [imageError, setImageError] = useState('');
  const [isSavingSettings, setIsSavingSettings] = useState(false);
  const [isDeletingNetwork, setIsDeletingNetwork] = useState(false);
  const [showDelete, setShowDelete] = useState(false);
  const [deleteConfirmationText, setDeleteConfirmationText] = useState('');

  /* eslint-disable react-hooks/set-state-in-effect -- syncs local form state from prop changes */
  useEffect(() => {
    setTitle(network.title);
    setLinkName(savedKey);
    setPrompt(network.prompt || '');
    setImageUrl(network.imageUrl ?? null);
    setOriginalTitle(network.title);
    setOriginalPrompt(network.prompt || '');
    setOriginalImageUrl(network.imageUrl ?? null);
    setImageFile(null);
    setImagePreview(null);
    setRemoveImageRequested(false);
    setDeleteConfirmationText('');
    setShowDelete(false);
    setImageError('');
  }, [network.id, network.title, network.prompt, network.imageUrl, savedKey]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const handleImageChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const validation = validateFiles([file], 'avatar');
      if (!validation.isValid) {
        setImageError(validation.message || 'Invalid image file');
        e.target.value = '';
        return;
      }
      setImageError('');
      setImageFile(file);
      setRemoveImageRequested(false);
      const reader = new FileReader();
      reader.onload = (ev) => setImagePreview(ev.target?.result as string);
      reader.readAsDataURL(file);
    }
  }, []);

  const resetSettings = () => {
    setTitle(originalTitle);
    setLinkName(savedKey);
    setPrompt(originalPrompt);
    setImageUrl(originalImageUrl);
    setImageFile(null);
    setImagePreview(null);
    setRemoveImageRequested(false);
    setImageError('');
    if (imageInputRef.current) imageInputRef.current.value = '';
  };

  const handleSaveSettings = async () => {
    if (!title.trim()) {
      error('Title cannot be empty');
      return;
    }
    try {
      setIsSavingSettings(true);
      let finalImageUrl: string | null = imageUrl;
      if (imageFile) finalImageUrl = await uploadImage(imageFile);
      else if (removeImageRequested) finalImageUrl = null;
      const keyChanged = linkName !== savedKey;
      const updatedIndex = await updateNetwork(networkId, {
        title: title.trim(), prompt: prompt.trim() || null, imageUrl: finalImageUrl,
        ...(keyChanged ? { key: linkName || null } : {}),
      });
      // Standing on the old link name, which no longer resolves: move to the new one.
      if (keyChanged && savedKey && window.location.pathname.startsWith(`/${savedKey}`)) {
        navigate(window.location.pathname.replace(`/${savedKey}`, linkName ? `/${linkName}` : `/networks/${networkId}`), { replace: true });
      }
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
      logger.error('Error updating network', { error: err });
      // A refused link name (rule broken, or taken by a person or network) says why.
      error(err instanceof APIError && (err.status === 400 || err.status === 409) ? err.message : 'Failed to update settings');
    } finally {
      setIsSavingSettings(false);
    }
  };

  const handleDeleteNetwork = async () => {
    try {
      setIsDeletingNetwork(true);
      await deleteNetwork(networkId);
      onRemoved(networkId);
      success('Network deleted');
      onDeleted?.();
    } catch (err) {
      logger.error('Error deleting network', { error: err });
      error('Failed to delete network');
    } finally {
      setIsDeletingNetwork(false);
    }
  };

  const displayImageUrl = imagePreview ? imagePreview : (removeImageRequested ? null : imageUrl);
  const hasImageChanged = imageFile !== null || removeImageRequested || (imageUrl !== originalImageUrl && !imageFile && !removeImageRequested);
  const hasSettingsChanged = title !== originalTitle || linkName !== savedKey || prompt !== originalPrompt || hasImageChanged;
  const busy = isSavingSettings || isDeletingNetwork;

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 13 }}>
        <span
          role="button"
          tabIndex={0}
          aria-label="change network picture"
          onClick={() => imageInputRef.current?.click()}
          onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); imageInputRef.current?.click(); } }}
          onMouseEnter={() => setHot(true)}
          onMouseLeave={() => setHot(false)}
          style={{ position: "relative", width: 72, height: 72, cursor: "pointer", display: "block" }}
        >
          <NetworkTile name={title || network.title} photo={displayImageUrl} size={72} />
          <span aria-hidden style={{
            position: "absolute", right: -1, bottom: -1, width: 16, height: 16,
            border: "1px solid #000", background: hot ? "#FF8A00" : "#000", color: hot ? "#000" : "#fff",
            display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, lineHeight: 1, pointerEvents: "none",
            transition: "background 120ms ease, color 120ms ease",
          }}>✎</span>
        </span>
        <input ref={imageInputRef} type="file" accept="image/*" onChange={handleImageChange} className="hidden" />
        {imageError && <span style={{ fontFamily: "var(--mac-sans)", fontSize: 11, color: "var(--ink-warn)" }}>{imageError}</span>}
        {displayImageUrl && (
          <button type="button" onClick={() => { setImageFile(null); setImagePreview(null); setRemoveImageRequested(true); if (imageInputRef.current) imageInputRef.current.value = ''; }} disabled={busy} style={{ border: "none", background: "transparent", cursor: "pointer", fontFamily: "var(--mac-mono)", fontSize: 12, color: "var(--ink-warn)" }}>Remove image</button>
        )}
      </div>

      <Field label="title" required>
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Network title" style={fieldInput} />
      </Field>
      <Field label="link">
        <div style={{ display: "flex", alignItems: "center", gap: 1 }}>
          <span style={{ fontFamily: "var(--mac-sans)", fontSize: 13, color: "var(--ink-2)", whiteSpace: "nowrap" }}>{window.location.host}/</span>
          <input
            value={linkName}
            // Same alphabet as usernames: lowercase letters, numbers, hyphens.
            onChange={(e) => setLinkName(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
            placeholder="network-name"
            autoComplete="off"
            data-1p-ignore
            style={fieldInput}
          />
        </div>
      </Field>
      <div>
        <div style={fieldLabel}>prompt</div>
        <div style={{ ...well, display: "flex", alignItems: "stretch" }}>
          <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="What people can share in this network…" rows={4} style={{ ...fieldInput, resize: "vertical", lineHeight: 1.5 }} />
        </div>
      </div>

      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
        <button type="button" disabled={!hasSettingsChanged || busy} onClick={resetSettings} style={plainBtn}>Cancel</button>
        <button type="button" disabled={!hasSettingsChanged || !title.trim() || busy} onClick={() => void handleSaveSettings()} style={{ ...plainBtn, background: "#000", color: "#fff" }}>{busy && isSavingSettings ? "Saving…" : "Save"}</button>
      </div>

      <div style={{ borderTop: "1px solid #ddd", paddingTop: 14 }}>
        <button type="button" onClick={() => setShowDelete((open) => !open)} aria-expanded={showDelete} style={{ display: "inline-flex", alignItems: "center", gap: 6, border: "none", background: "transparent", cursor: "pointer", fontFamily: "var(--mac-mono)", fontSize: 12, color: "var(--ink-warn)" }}>
          <span aria-hidden style={{ fontSize: 10, lineHeight: 1 }}>{showDelete ? "▲" : "▼"}</span>
          Danger Zone
        </button>
        {showDelete && (
          <div style={{ marginTop: 10, padding: 12, border: "1px solid var(--ink-warn)", background: "#FFF5F5", display: "grid", gap: 10 }}>
            <p style={{ margin: 0, fontFamily: "var(--mac-sans)", fontSize: 13, color: "#8A0000" }}>Delete this network. Type the name to confirm.</p>
            <input value={deleteConfirmationText} onChange={(e) => setDeleteConfirmationText(e.target.value)} placeholder={network.title} style={{ padding: "8px 10px", border: "1px solid #000", fontFamily: "var(--mac-mono)", fontSize: 12 }} />
            <button type="button" disabled={deleteConfirmationText !== network.title || busy} onClick={() => void handleDeleteNetwork()} style={{ justifySelf: "end", fontFamily: "var(--mac-mono)", fontSize: 12, padding: "7px 14px", border: "1px solid var(--ink-warn)", background: "#8A0000", color: "#fff", cursor: "pointer" }}>Delete</button>
          </div>
        )}
      </div>
    </div>
  );
}

const fieldLabel: React.CSSProperties = { marginBottom: 5, fontFamily: "var(--mac-mono)", fontSize: 11, fontWeight: 600 };
const fieldInput: React.CSSProperties = { width: "100%", background: "transparent", border: "none", outline: "none", fontFamily: "var(--mac-sans)", fontSize: 13 };
const well: React.CSSProperties = { border: "1px solid #000", background: "#fff", boxShadow: "inset 1px 1px 0 var(--ink-3), inset -1px -1px 0 #fff", padding: "7px 10px" };
const plainBtn: React.CSSProperties = { fontFamily: "var(--mac-mono)", fontSize: 13, padding: "7px 15px", border: "1px solid #000", background: "#fff", cursor: "pointer" };

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <div style={fieldLabel}>{label}{required && <span style={{ color: "#FF8A00", marginLeft: 4 }}>*</span>}</div>
      <div style={{ ...well, padding: "7px 10px" }}>{children}</div>
    </div>
  );
}
