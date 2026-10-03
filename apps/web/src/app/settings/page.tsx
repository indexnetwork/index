import { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { useAuthContext } from "@/contexts/AuthContext";
import { useAuth } from "@/contexts/APIContext";
import { useNotifications } from "@/contexts/NotificationContext";
import UserAvatar from "@/components/UserAvatar";
import { validateFiles } from "@/lib/file-validation";
import ClientLayout from "@/components/ClientLayout";
import { ConfirmWindow, RuleLabel, Segmented, Stage, Window } from "@/components/workbench/Workbench";
import ApiKeysSection from "@/components/settings/ApiKeysSection";
import DevicesSection from "@/components/settings/DevicesSection";
import SettingsTabs from "@/components/settings/SettingsTabs";
import { parseSocial } from "@/lib/socials";
import { forgetProtocolOrigin, isProtocolOrigin, rememberProtocolOrigin, visibleProtocolOrigin } from "@/lib/protocol-origin";

const SETTINGS_TABS = ["profile", "notifications", "access", "advanced"] as const;

const PROTOCOL_PRESETS = [
  { value: "main", label: "main", url: "https://protocol.index.network", web: "https://index.network" },
  { value: "dev", label: "dev", url: "https://protocol.dev.index.network", web: "https://dev.index.network" },
  { value: "local", label: "local", url: "http://localhost:3001", web: "http://localhost:3000" },
] as const;
type SettingsTab = (typeof SETTINGS_TABS)[number];

function isSettingsTab(v: string | null): v is SettingsTab {
  return v !== null && (SETTINGS_TABS as readonly string[]).includes(v);
}

export default function ProfilePage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { user, isAuthenticated, isLoading: authLoading, refetchUser, signOut } = useAuthContext();
  const authService = useAuth();
  const { success, error } = useNotifications();

  const [name, setName] = useState("");
  const [intro, setIntro] = useState("");
  const [location, setLocation] = useState("");
  const [timezone, setTimezone] = useState("");
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [avatarError, setAvatarError] = useState<string | null>(null);
  const [socials, setSocials] = useState<Array<{ label: string; value: string }>>([]);
  const getSocial = (label: string) => socials.find(s => s.label === label)?.value ?? '';
  const setSocial = (label: string, value: string) => {
    setSocials(prev => {
      const without = prev.filter(s => s.label !== label);
      return value ? [...without, { label, value }] : without;
    });
    mark();
  };
  const customSocials = socials.filter(s => !['linkedin', 'twitter', 'github', 'telegram'].includes(s.label));

  const [notificationPreferences, setNotificationPreferences] = useState<{
    connectionUpdates: boolean;
    morningBrief?: boolean;
  }>({
    connectionUpdates: true,
  });

  const tabParam = searchParams.get("tab");
  const activeTab: SettingsTab = isSettingsTab(tabParam) ? tabParam : "profile";

  const [saving, setSaving] = useState(false);
  const [, setIsDirty] = useState(false);

  const [isDangerZoneExpanded, setIsDangerZoneExpanded] = useState(false);
  const [showDeleteConfirmation, setShowDeleteConfirmation] = useState(false);
  const [deleteConfirmationText, setDeleteConfirmationText] = useState("");
  const [isDeletingAccount, setIsDeletingAccount] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!authLoading && !isAuthenticated) navigate("/");
  }, [authLoading, isAuthenticated, navigate]);

  const resetForm = (u: typeof user) => {
    if (!u) return;
    setName(u.name || "");
    setIntro(u.intro || "");
    setLocation(u.location || "");
    setTimezone(u.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone);
    setSocials((u.socials ?? []).map((s: { label: string; value: string }) => ({ label: s.label, value: s.value })));
    setNotificationPreferences(
      u.notificationPreferences || { connectionUpdates: true }
    );
    setAvatarFile(null);
    setAvatarPreview(null);
    setAvatarError(null);
    setIsDirty(false);
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally runs only when user changes; state setters are stable
  useEffect(() => { resetForm(user); }, [user]); // eslint-disable-line react-hooks/set-state-in-effect -- resetForm mirrors server-fetched user into editable form fields; legitimate sync-from-external-state pattern.

  const mark = () => setIsDirty(true);

  const handleAvatarChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const validation = validateFiles([file], "avatar");
    if (!validation.isValid) {
      setAvatarError(validation.message || "Invalid file");
      e.target.value = "";
      return;
    }
    setAvatarError(null);
    setAvatarFile(file);
    setIsDirty(true);
    const reader = new FileReader();
    reader.onload = (evt) => setAvatarPreview(evt.target?.result as string);
    reader.readAsDataURL(file);
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      let avatarFilename = user?.avatar;
      if (avatarFile) avatarFilename = await authService.uploadAvatar(avatarFile);

      const socialsPayload = socials.filter(s => s.value.trim() !== '');

      await authService.updateProfile({
        name: name || undefined,
        intro: intro || undefined,
        location: location || undefined,
        avatar: avatarFilename || undefined,
                      Timezone: timezone || undefined,
        socials: socialsPayload,
        notificationPreferences,
      });

      await refetchUser();
      setAvatarFile(null);
      setAvatarPreview(null);
      setIsDirty(false);
      success("Profile saved");
    } catch {
      error("Failed to save profile");
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteAccount = async () => {
    setIsDeletingAccount(true);
    try {
      await authService.deleteAccount();
      await signOut();
      navigate("/");
    } catch {
      error("Failed to delete account");
      setIsDeletingAccount(false);
    }
  };

  if (authLoading) {
    return (
      <ClientLayout>
        <p style={{ padding: 24, fontFamily: "var(--mac-mono)", fontSize: 12 }}>loading…</p>
      </ClientLayout>
    );
  }


  return (
      <ClientLayout>
        <Stage width={860} height="min(660px, calc(100vh - 112px))">
        <Window title="settings" onClose={() => navigate("/")} style={{ height: "100%" }}>
        <div className="mac-scroll" style={{ flex: 1, overflowY: "auto", padding: "18px 24px 22px" }}>
          <div style={{ marginBottom: 18 }}>
            <SettingsTabs />
          </div>

          {activeTab === "profile" && (
          <div className="space-y-10">

            {/* Identity header */}
            <PhotoPicker
              name={name || user?.name || ""}
              preview={avatarPreview}
              userId={user?.id}
              userName={user?.name}
              avatar={user?.avatar}
              onPick={() => fileInputRef.current?.click()}
            />
            <input ref={fileInputRef} type="file" accept="image/*" onChange={handleAvatarChange} className="hidden" />
            {avatarError && <p style={{ margin: 0, fontFamily: "var(--mac-mono)", fontSize: 12, color: "var(--ink-warn)" }}>{avatarError}</p>}

            <div className="space-y-4 pt-2">

              <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", gap: "14px 18px" }}>
                <MacField label="name" required value={name} onChange={(v) => { setName(v); mark(); }} />
                <MacField label="email" value={user?.email || ""} disabled />
                <MacField label="location" value={location} onChange={(v) => { setLocation(v); mark(); }} />
              </div>

              <div>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 5, fontFamily: "var(--mac-mono)", fontSize: 11, fontWeight: 600 }}>
                  <span>introduction</span>
                  <span style={{ color: intro.length > 500 ? "var(--ink-warn)" : "var(--ink-2)", fontWeight: intro.length > 500 ? 700 : 400 }}>{intro.length}/500</span>
                </div>
                <div style={{ border: "1px solid #000", background: "#fff", boxShadow: "inset 1px 1px 0 var(--ink-3), inset -1px -1px 0 #fff", padding: "8px 10px" }}>
                  <textarea id="intro" value={intro} rows={4} onChange={(e) => { setIntro(e.target.value); mark(); }} style={{ width: "100%", border: "none", outline: "none", resize: "vertical", background: "transparent", fontFamily: "var(--mac-sans)", fontSize: 13, lineHeight: 1.5 }} />
                </div>
              </div>
            </div>

            {/* Socials */}
            <div style={{ marginTop: 8 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "18px 0 12px", fontFamily: "var(--mac-mono)", fontSize: 11, letterSpacing: 1.4, textTransform: "uppercase", fontWeight: 700 }}>
                <span>socials</span>
                <span style={{ flex: 1, height: 1, background: "#000" }} />
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", gap: "9px 14px" }}>
                {[
                  { prefix: "x.com/", label: "twitter", value: getSocial("twitter") },
                  { prefix: "linkedin.com/in/", label: "linkedin", value: getSocial("linkedin") },
                  { prefix: "github.com/", label: "github", value: getSocial("github") },
                  { prefix: "t.me/", label: "telegram", value: getSocial("telegram") },
                ].map(({ prefix, label, value }) => (
                  <label key={label} style={{ display: "flex", alignItems: "center", border: "1px solid #000", background: "#fff", minWidth: 0 }}>
                    <span style={{ padding: "8px 8px", fontFamily: "var(--mac-mono)", fontSize: 11, color: "var(--ink-2)", borderRight: "1px solid #000", whiteSpace: "nowrap" }}>{prefix}</span>
                    <input
                      value={value}
                      placeholder="username"
                      onChange={(e) => setSocial(label, e.target.value)}
                      onBlur={(e) => {
                        const resolved = parseSocial({ label, value: e.target.value });
                        const platform = label === "twitter" ? "x" : label;
                        setSocial(label, resolved.platform === platform ? resolved.handle : e.target.value.trim());
                      }}
                      style={{ flex: 1, minWidth: 0, border: "none", outline: "none", padding: "8px 10px", fontFamily: "var(--mac-sans)", fontSize: 13, background: "transparent" }}
                    />
                  </label>
                ))}
                {customSocials.map((social, index) => (
                  <label key={index} style={{ display: "flex", alignItems: "center", border: "1px solid #000", background: "#fff", minWidth: 0 }}>
                    <input
                      value={social.value}
                      placeholder="https://"
                      onChange={(e) => {
                        setSocials((prev) => prev.map((s) => s === social ? { label: "custom", value: e.target.value } : s));
                        mark();
                      }}
                      style={{ flex: 1, minWidth: 0, border: "none", outline: "none", padding: "8px 10px", fontFamily: "var(--mac-sans)", fontSize: 13, background: "transparent" }}
                    />
                    <button type="button" onClick={() => { setSocials((prev) => prev.filter((s) => s !== social)); mark(); }} style={{ border: "none", borderLeft: "1px solid #000", background: "#fff", fontFamily: "var(--mac-mono)", fontSize: 11, padding: "8px 10px", cursor: "pointer" }}>remove</button>
                  </label>
                ))}
                {customSocials.length < 3 && (
                  <button type="button" onClick={() => { setSocials((prev) => [...prev, { label: "custom", value: "" }]); mark(); }} style={{ justifySelf: "start", padding: "9px 14px", border: "1px dashed #000", background: "transparent", fontFamily: "var(--mac-mono)", fontSize: 11, color: "var(--ink-2)", cursor: "pointer" }}>+ add website</button>
                )}
              </div>
            </div>

            {/* Danger Zone */}
            <div style={{ marginTop: 26 }}>
              <button type="button" onClick={() => setIsDangerZoneExpanded((open) => !open)} style={{ display: "flex", alignItems: "center", gap: 7, padding: 0, border: "none", background: "transparent", cursor: "pointer", fontFamily: "var(--mac-mono)", fontSize: 11, fontWeight: 700, letterSpacing: 0.6, color: "var(--ink-warn)", textTransform: "uppercase" }}>
                <span style={{ display: "inline-block", transform: isDangerZoneExpanded ? "rotate(90deg)" : "none" }}>›</span>
                danger zone
              </button>
              {isDangerZoneExpanded && (
                <div style={{ marginTop: 10, padding: "11px 12px", border: "1px solid var(--ink-warn)", background: "#FFF3F3", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                  <div>
                    <div style={{ fontFamily: "var(--mac-mono)", fontSize: 12, fontWeight: 600, color: "var(--ink-warn)" }}>delete account</div>
                    <div style={{ marginTop: 3, fontFamily: "var(--mac-sans)", fontSize: 12, lineHeight: 1.45, color: "var(--ink-2)" }}>index stops immediately and every signal closes. connections you&apos;ve already made stay with the other person.</div>
                  </div>
                  <button type="button" onClick={() => { setDeleteConfirmationText(""); setShowDeleteConfirmation(true); }} style={{ fontFamily: "var(--mac-mono)", fontSize: 12, padding: "6px 15px", border: "1px solid var(--ink-warn)", background: "var(--ink-warn)", color: "#fff", cursor: "pointer" }}>delete</button>
                </div>
              )}
            </div>

          </div>
          )}

          {activeTab === "access" && (
              <div style={{ display: "grid", gap: 22 }}>
                <ApiKeysSection />
                <DevicesSection />
              </div>
          )}

          {activeTab === "advanced" && <AdvancedPane signOut={signOut} />}

          {activeTab === "notifications" && (
              <div className="space-y-10">
                <div className="space-y-4">
                  <p style={{ fontFamily: "var(--mac-sans)", fontSize: 13, lineHeight: 1.5, color: "var(--ink-2)", marginBottom: 14 }}>
                    index works in the background. choose what&apos;s worth interrupting you for.
                  </p>
                  <label htmlFor="timezone" style={{ display: "block", marginBottom: 5, fontFamily: "var(--mac-mono)", fontSize: 11, fontWeight: 600 }}>timezone</label>
                  <select id="timezone" value={timezone} onChange={(e) => { setTimezone(e.target.value); mark(); }} style={{ width: "100%", border: "1px solid #000", background: "#fff", padding: "8px 10px", fontFamily: "var(--mac-sans)", fontSize: 13 }}>
                    {Intl.supportedValuesOf("timeZone").map((tz) => (
                      <option key={tz} value={tz}>{tz.replace(/_/g, " ")}</option>
                    ))}
                  </select>
                  <label style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, border: "1px solid #000", padding: "10px 12px", background: "#fff" }}>
                    <span>
                      <span style={{ display: "block", fontFamily: "var(--mac-mono)", fontSize: 12, fontWeight: 700 }}>an intro is accepted</span>
                      <span style={{ display: "block", marginTop: 3, fontFamily: "var(--mac-sans)", fontSize: 12, color: "var(--ink-2)" }}>both of you said yes, and the chat opens on both sides.</span>
                    </span>
                    <input type="checkbox" checked={notificationPreferences.connectionUpdates} onChange={(e) => { setNotificationPreferences((prev) => ({ ...prev, connectionUpdates: e.target.checked })); mark(); }} />
                  </label>
                  <label style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, border: "1px solid #000", padding: "10px 12px", background: "#fff" }}>
                    <span>
                      <span style={{ display: "block", fontFamily: "var(--mac-mono)", fontSize: 12, fontWeight: 700 }}>daily brief</span>
                      <span style={{ display: "block", marginTop: 3, fontFamily: "var(--mac-sans)", fontSize: 12, color: "var(--ink-2)" }}>your agent looks again at 08:00, and speaks only when it has something new.</span>
                    </span>
                    <input type="checkbox" checked={notificationPreferences.morningBrief !== false} onChange={(e) => { setNotificationPreferences((prev) => ({ ...prev, morningBrief: e.target.checked })); mark(); }} />
                  </label>
                </div>
              </div>
          )}

        </div>
        <div style={{
          borderTop: "2px solid #000", padding: "11px 24px",
          display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 10,
          flex: "0 0 auto", background: "#fff",
        }}>
          <button type="button" onClick={() => navigate("/")} disabled={saving} style={{
            fontFamily: "var(--mac-mono)", fontSize: 13, padding: "7px 17px",
            border: "1px solid #000", background: "#fff", color: "#000",
            boxShadow: "1px 1px 0 rgba(0,0,0,0.2)", cursor: saving ? "default" : "pointer",
          }}>cancel</button>
          <button type="button" onClick={() => void handleSave()} disabled={saving || !!avatarError} style={{
            fontFamily: "var(--mac-mono)", fontSize: 13, padding: "7px 19px",
            border: "1px solid #000", background: "#000", color: "#fff",
            boxShadow: "1px 1px 0 rgba(0,0,0,0.2)", cursor: "pointer", fontWeight: 700,
            opacity: saving || avatarError ? 0.5 : 1,
          }}>{saving ? "saving…" : "save changes"}</button>
        </div>
        </Window>
        </Stage>
      {showDeleteConfirmation && (
        <ConfirmWindow
          title="delete account"
          body="this cannot be undone. type your email to confirm."
          confirmLabel="delete"
          busy={isDeletingAccount}
          disabled={deleteConfirmationText !== user?.email}
          onCancel={() => { if (!isDeletingAccount) setShowDeleteConfirmation(false); }}
          onConfirm={() => void handleDeleteAccount()}
        >
          <input value={deleteConfirmationText} onChange={(e) => setDeleteConfirmationText(e.target.value)} placeholder={user?.email || "you@example.com"} style={{ width: "100%", border: "1px solid #000", padding: "8px 10px" }} />
        </ConfirmWindow>
      )}
      </ClientLayout>
  );
}

function PhotoPicker({ name, preview, userId, userName, avatar, onPick }: {
  name: string;
  preview: string | null;
  userId?: string;
  userName?: string;
  avatar?: string | null;
  onPick: () => void;
}) {
  const [hot, setHot] = useState(false);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
      <span
        role="button"
        tabIndex={0}
        aria-label="change photo"
        title="change photo"
        onClick={onPick}
        onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onPick(); } }}
        onMouseEnter={() => setHot(true)}
        onMouseLeave={() => setHot(false)}
        onFocus={() => setHot(true)}
        onBlur={() => setHot(false)}
        style={{ position: "relative", width: 54, height: 54, flex: "0 0 auto", display: "block", cursor: "pointer", outline: "none" }}
      >
        {preview ? (
          <img src={preview} alt="" width={54} height={54} style={{ width: 54, height: 54, objectFit: "cover", display: "block", borderRadius: 0 }} />
        ) : (
          <UserAvatar id={userId} name={userName} avatar={avatar} size={54} />
        )}
        <span aria-hidden style={{
          position: "absolute", right: -1, bottom: -1, width: 16, height: 16,
          border: "1px solid #000", background: hot ? "#FF8A00" : "#000", color: hot ? "#000" : "#fff",
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 10, lineHeight: 1, pointerEvents: "none", borderRadius: 0,
        }}>✎</span>
      </span>
      <div style={{ fontFamily: "var(--mac-mono)", fontSize: 17, fontWeight: 700 }}>{name}</div>
    </div>
  );
}

function AdvancedPane({ signOut }: { signOut: () => Promise<void> }) {
  const active = visibleProtocolOrigin();
  const preset = PROTOCOL_PRESETS.find((item) => item.url === active);
  const [choice, setChoice] = useState<string>(preset ? preset.value : "custom");
  const [custom, setCustom] = useState(preset ? "" : active);

  const apply = async (url: string) => {
    const next = url.trim().replace(/\/+$/, "");
    if (!isProtocolOrigin(next) || next === active) return;
    try { await signOut(); } catch { /* leaving this server is the point */ }
    const target = PROTOCOL_PRESETS.find((item) => item.url === next);
    if (target) {
      forgetProtocolOrigin();
      if (target.web !== window.location.origin) {
        window.location.assign(target.web);
        return;
      }
    } else {
      rememberProtocolOrigin(next);
    }
    window.location.reload();
  };

  return (
    <div>
      <RuleLabel>protocol server</RuleLabel>
      <p style={{ margin: "12px 0", maxWidth: 520, fontFamily: "var(--mac-sans)", fontSize: 13, lineHeight: 1.5, color: "var(--ink-2)" }}>
        requests go to <span style={{ fontFamily: "var(--mac-mono)", fontSize: 12 }}>{active}</span>.
        switching signs you out — a session belongs to the server it was made on.
      </p>
      <Segmented
        value={choice}
        onChange={(value) => {
          setChoice(value);
          const next = PROTOCOL_PRESETS.find((item) => item.value === value);
          if (next) void apply(next.url);
        }}
        options={[...PROTOCOL_PRESETS.map((item) => ({ value: item.value, label: item.label })), { value: "custom", label: "custom" }]}
      />
      {choice === "custom" && (
        <div style={{ marginTop: 12, maxWidth: 360 }}>
          <div style={{ marginBottom: 5, fontFamily: "var(--mac-mono)", fontSize: 11, fontWeight: 600 }}>origin</div>
          <div style={{ border: "1px solid #000", background: "#fff", boxShadow: "inset 1px 1px 0 var(--ink-3), inset -1px -1px 0 #fff", padding: "7px 10px" }}>
            <input
              value={custom}
              placeholder="https://protocol.example.com"
              onChange={(event) => setCustom(event.target.value)}
              onBlur={() => void apply(custom)}
              onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void apply(custom); } }}
              style={{ width: "100%", background: "transparent", border: "none", outline: "none", fontFamily: "var(--mac-sans)", fontSize: 13 }}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function MacField({ label, value, onChange, disabled, required }: {
  label: string; value: string; onChange?: (value: string) => void; disabled?: boolean; required?: boolean;
}) {
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ marginBottom: 5, fontFamily: "var(--mac-mono)", fontSize: 11, fontWeight: 600 }}>
        {label}{required && <span style={{ color: "#FF8A00", marginLeft: 4 }}>*</span>}
      </div>
      <div style={{
        border: "1px solid #000",
        background: disabled ? "#EDEAE1" : "#fff",
        boxShadow: "inset 1px 1px 0 var(--ink-3), inset -1px -1px 0 #fff",
        padding: "7px 10px",
      }}>
        <input
          value={value}
          disabled={disabled}
          onChange={(e) => onChange?.(e.target.value)}
          style={{ width: "100%", background: "transparent", border: "none", outline: "none", fontFamily: "var(--mac-sans)", fontSize: 13, color: disabled ? "var(--ink-2)" : "#000" }}
        />
      </div>
    </div>
  );
}

export const Component = ProfilePage;
