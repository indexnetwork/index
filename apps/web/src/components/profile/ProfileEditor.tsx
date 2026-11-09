import { useRef, useState, type ChangeEvent } from "react";

import UserAvatar from "@/components/UserAvatar";
import { useAuthContext } from "@/contexts/AuthContext";
import { useAuth } from "@/contexts/APIContext";
import { useNotifications } from "@/contexts/NotificationContext";
import { validateFiles } from "@/lib/file-validation";
import { parseSocial } from "@/lib/socials";

type Social = { label: string; value: string };

const SOCIALS = [
  { label: "twitter", platform: "x", prefix: "x.com/" },
  { label: "linkedin", platform: "linkedin", prefix: "linkedin.com/in/" },
  { label: "github", platform: "github", prefix: "github.com/" },
  { label: "telegram", platform: "telegram", prefix: "t.me/" },
] as const;

/**
 * Your own profile, edited in place on the profile page: photo, name,
 * location, bio and the usual handles. Other links are kept as they are.
 */
export default function ProfileEditor<T>({ onSaved, onCancel }: {
  onSaved: (user: T) => void;
  onCancel: () => void;
}) {
  const { user, refetchUser } = useAuthContext();
  const authService = useAuth();
  const { success, error } = useNotifications();
  const fileRef = useRef<HTMLInputElement>(null);

  const [name, setName] = useState(user?.name ?? "");
  const [location, setLocation] = useState(user?.location ?? "");
  const [intro, setIntro] = useState(user?.intro ?? "");
  const [socials, setSocials] = useState<Social[]>(
    (user?.socials ?? []).map((s: Social) => ({ label: s.label, value: s.value })),
  );
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const social = (label: string) => socials.find((s) => s.label === label)?.value ?? "";
  const setSocial = (label: string, value: string) =>
    setSocials((prev) => [...prev.filter((s) => s.label !== label), ...(value ? [{ label, value }] : [])]);

  const pickPhoto = (event: ChangeEvent<HTMLInputElement>) => {
    const picked = event.target.files?.[0];
    if (!picked) return;
    const check = validateFiles([picked], "avatar");
    if (!check.isValid) {
      setFileError(check.message || "that file won't work as a photo.");
      event.target.value = "";
      return;
    }
    setFileError(null);
    setFile(picked);
    const reader = new FileReader();
    reader.onload = (e) => setPreview(e.target?.result as string);
    reader.readAsDataURL(picked);
  };

  const save = async () => {
    setSaving(true);
    try {
      const avatar = file ? await authService.uploadAvatar(file) : user?.avatar;
      const saved = await authService.updateProfile({
        name: name.trim() || undefined,
        location: location.trim() || undefined,
        intro: intro.trim() || undefined,
        avatar: avatar || undefined,
        socials: socials.filter((s) => s.value.trim() !== ""),
      });
      await refetchUser();
      success("Profile saved");
      onSaved(saved as T);
    } catch {
      error("Failed to save profile");
    } finally {
      setSaving(false);
    }
  };

  return (
    <form className="pl-edit" onSubmit={(e) => { e.preventDefault(); void save(); }}>
      <button type="button" className="pl-edit-photo" aria-label="change photo" title="change photo" onClick={() => fileRef.current?.click()}>
        {preview
          ? <img src={preview} alt="" width={96} height={96} />
          : <UserAvatar id={user?.id} name={user?.name} avatar={user?.avatar} size={96} />}
        <span className="pl-edit-photo-tag">change</span>
      </button>
      <input ref={fileRef} type="file" accept="image/*" hidden onChange={pickPhoto} />
      {fileError && <p className="pl-edit-err">{fileError}</p>}

      <label className="pl-edit-field">
        <span>name</span>
        <input type="text" value={name} required onChange={(e) => setName(e.target.value)} />
      </label>
      <label className="pl-edit-field">
        <span>location</span>
        <input type="text" value={location} placeholder="city, country" onChange={(e) => setLocation(e.target.value)} />
      </label>
      <label className="pl-edit-field">
        <span>bio</span>
        <textarea value={intro} rows={6} onChange={(e) => setIntro(e.target.value)} />
      </label>

      <div className="pl-edit-field">
        <span>elsewhere</span>
        {SOCIALS.map(({ label, platform, prefix }) => (
          <label key={label} className="pl-edit-social">
            <span className="pl-edit-prefix">{prefix}</span>
            <input
              type="text"
              value={social(label)}
              placeholder="username"
              onChange={(e) => setSocial(label, e.target.value)}
              onBlur={(e) => {
                const resolved = parseSocial({ label, value: e.target.value });
                setSocial(label, resolved.platform === platform ? resolved.handle : e.target.value.trim());
              }}
            />
          </label>
        ))}
      </div>

      <div className="pl-edit-actions">
        <button type="button" onClick={onCancel} disabled={saving}>cancel</button>
        <button type="submit" className="go" disabled={saving || !name.trim() || !!fileError}>{saving ? "saving…" : "save"}</button>
      </div>
    </form>
  );
}
