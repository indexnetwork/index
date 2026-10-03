import { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { useAuthContext } from "@/contexts/AuthContext";
import { useAuth } from "@/contexts/APIContext";
import { useNotifications } from "@/contexts/NotificationContext";
import UserAvatar from "@/components/UserAvatar";
import { validateFiles } from "@/lib/file-validation";
import ClientLayout from "@/components/ClientLayout";
import { ConfirmWindow, Stage, Window } from "@/components/workbench/Workbench";
import { SaveBarProvider } from "@/contexts/SaveBarContext";
import ApiKeysSection from "@/components/settings/ApiKeysSection";
import DevicesSection from "@/components/settings/DevicesSection";
import SettingsTabs from "@/components/settings/SettingsTabs";
import { parseSocial } from "@/lib/socials";

const SETTINGS_TABS = ["profile", "notifications", "access"] as const;
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

  const [notificationPreferences, setNotificationPreferences] = useState({
    connectionUpdates: true,
  });

  const tabParam = searchParams.get("tab");
  const activeTab: SettingsTab = isSettingsTab(tabParam) ? tabParam : "profile";

  const [saving, setSaving] = useState(false);
  const [isDirty, setIsDirty] = useState(false);

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

  const handleDiscard = () => resetForm(user);

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
    <SaveBarProvider visible={isDirty}>
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
            <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
              <button type="button" onClick={() => fileInputRef.current?.click()} style={{ padding: 0, border: "1px solid #000", background: "#fff", cursor: "pointer", lineHeight: 0 }}>
                {avatarPreview ? (
                  <img src={avatarPreview} alt="" width={72} height={72} style={{ width: 72, height: 72, objectFit: "cover", display: "block" }} />
                ) : (
                  <UserAvatar id={user?.id} name={user?.name} avatar={user?.avatar} size={72} />
                )}
              </button>
              <input ref={fileInputRef} type="file" accept="image/*" onChange={handleAvatarChange} className="hidden" />
              <div>
                <div style={{ fontFamily: "var(--mac-mono)", fontSize: 14, fontWeight: 700 }}>{name || "your name"}</div>
                <button type="button" onClick={() => fileInputRef.current?.click()} style={{ marginTop: 4, background: "none", border: "none", padding: 0, fontFamily: "var(--mac-mono)", fontSize: 11, color: "var(--ink-2)", cursor: "pointer", textDecoration: "underline" }}>change photo</button>
              </div>
            </div>
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
              <div className="space-y-10">
                <ApiKeysSection />
                <DevicesSection />
              </div>
          )}

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
                    <input type="checkbox" checked={notificationPreferences.connectionUpdates} onChange={(e) => { setNotificationPreferences({ connectionUpdates: e.target.checked }); mark(); }} />
                  </label>
                </div>
              </div>
          )}

        </div>
        </Window>
        </Stage>

      {/* Sticky save bar */}
      {isDirty && (
        <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-black z-40 px-6">
          <div className="max-w-3xl mx-auto py-3 grid grid-cols-1 sm:grid-cols-2 gap-4 items-center">
            <span style={{ fontFamily: "var(--mac-sans)", fontSize: 13 }}>unsaved changes</span>
            <div className="flex items-center gap-2 justify-self-end">
              <button type="button" className="wb-btn" onClick={handleDiscard} disabled={saving}>cancel</button>
              <button type="button" className="wb-btn primary" onClick={handleSave} disabled={saving || !!avatarError}>
                {saving ? "saving…" : "save changes"}
              </button>
            </div>
          </div>
        </div>
      )}
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
    </SaveBarProvider>
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
