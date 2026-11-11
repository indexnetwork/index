import { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { useAuthContext } from "@/contexts/AuthContext";
import { useAuth } from "@/contexts/APIContext";
import { useNotifications } from "@/contexts/NotificationContext";
import UserAvatar from "@/components/UserAvatar";
import { validateFiles } from "@/lib/file-validation";
import { Stage, Window } from "@/components/workbench/Workbench";
import PageHead from "@/components/intents-home/PageHead";
import { useInAppFrame } from "@/components/intents-home/appFrameContext";
import "@/styles/plain.css";
import ApiKeysSection from "@/components/settings/ApiKeysSection";
import DevicesSection from "@/components/settings/DevicesSection";
import SettingsTabs from "@/components/settings/SettingsTabs";
import AgentsPage from "@/app/agents/page";
import { parseSocial } from "@/lib/socials";
import { forgetProtocolOrigin, isProtocolOrigin, rememberProtocolOrigin, visibleProtocolOrigin } from "@/lib/protocol-origin";
import { useCompact } from "@/hooks/useCompact";
import { useBack } from "@/hooks/useBack";
import { assembleFirstRunProfile, lookupFoundNothing, onboardingService, type PublicProfileLookup } from "@/services/onboarding";

const SETTINGS_TABS = ["profile", "agents", "notifications", "access", "advanced"] as const;

const PROTOCOL_PRESETS = [
  { value: "main", label: "main", url: "https://protocol.index.network", web: "https://index.network" },
  { value: "dev", label: "dev", url: "https://protocol.dev.index.network", web: "https://dev.index.network" },
  { value: "local", label: "local", url: "http://localhost:3001", web: "http://localhost:3000" },
] as const;
type SettingsTab = (typeof SETTINGS_TABS)[number];

function isSettingsTab(v: string | null): v is SettingsTab {
  return v !== null && (SETTINGS_TABS as readonly string[]).includes(v);
}

/**
 * First run: the getting-started review the Mac app shows after the lookup.
 * Profile only, prefilled from the lookup; "looks good" saves, confirms the
 * profile, then hands off to `onDone`.
 */
export interface FirstRunReview {
  lookup: PublicProfileLookup | null;
  name: string;
  onDone: () => void;
}

export default function ProfilePage() {
  return <ProfileSettings />;
}

export function ProfileSettings({ firstRun }: { firstRun?: FirstRunReview } = {}) {
  const navigate = useNavigate();
  const compact = useCompact();
  // Signed in on desktop the page sits in the app frame; first run keeps its window.
  const plain = useInAppFrame() && !firstRun;
  const back = useBack("/");
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
    opportunity?: boolean;
    accepted?: boolean;
    messages?: boolean;
    morningBrief?: boolean;
  }>({});

  const tabParam = searchParams.get("tab");
  const activeTab: SettingsTab = firstRun ? "profile" : isSettingsTab(tabParam) ? tabParam : "profile";

  const [saving, setSaving] = useState(false);
  const [isDirty, setIsDirty] = useState(false);

  const [isDangerZoneExpanded, setIsDangerZoneExpanded] = useState(false);
  const [deleteConfirmationText, setDeleteConfirmationText] = useState("");
  const [isDeletingAccount, setIsDeletingAccount] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!authLoading && !isAuthenticated) navigate("/");
  }, [authLoading, isAuthenticated, navigate]);

  const resetForm = (u: typeof user) => {
    if (!u) return;
    // First run opens on the account record with the lookup filling its blanks.
    const base = firstRun
      ? assembleFirstRunProfile(u, firstRun.lookup, firstRun.name)
      : { name: u.name || "", intro: u.intro || "", location: u.location || "", socials: (u.socials ?? []).map((s: { label: string; value: string }) => ({ label: s.label, value: s.value })) };
    setName(base.name);
    setIntro(base.intro);
    setLocation(base.location);
    setTimezone(u.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone);
    setSocials(base.socials);
    setNotificationPreferences(u.notificationPreferences || {});
    setAvatarFile(null);
    setAvatarPreview(null);
    setAvatarError(null);
    setIsDirty(false);
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally runs only when user changes; state setters are stable
  useEffect(() => { resetForm(user); }, [user]); // eslint-disable-line react-hooks/set-state-in-effect -- resetForm mirrors server-fetched user into editable form fields; legitimate sync-from-external-state pattern.

  const mark = () => setIsDirty(true);
  // First run, when the lookup wrote about someone else: empty the bio and hand it over.
  const writeOwnIntro = () => {
    setIntro("");
    mark();
    document.getElementById("intro")?.focus();
  };
  // The server only confirms a profile that has a name or an intro.
  const confirmBlocked = !!firstRun && !name.trim() && !intro.trim();

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
        timezone: timezone || undefined,
        socials: socialsPayload,
        notificationPreferences,
      });

      if (firstRun) {
        // Same order as the Mac app: save, confirm, then the first intent.
        await onboardingService.confirmProfile();
        await refetchUser();
        firstRun.onDone();
        return;
      }
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
      <>
        <p style={{ padding: 24, fontFamily: "var(--mac-sans)", fontSize: 12, color: "var(--ink-3)" }}>loading…</p>
      </>
    );
  }


  const NOTIFY: Array<{ key: "opportunity" | "accepted" | "messages" | "morningBrief"; title: string; body: string }> = [
    { key: "opportunity", title: "an opportunity surfaces", body: "your agent found someone who meets your intents and wants you to review." },
    { key: "accepted", title: "an intro is accepted", body: "both of you said yes, and the chat opens on both sides." },
    { key: "messages", title: "a message arrives", body: "a connection wrote to you; emailed if unread after a minute." },
    { key: "morningBrief", title: "daily brief", body: "your agent looks again at 08:00, and emails you only when it needs you." },
  ];

  const body = (
    <>
      {activeTab === "profile" && (
        <div className="st-stack">
          <PhotoPicker
            name={name || user?.name || ""}
            preview={avatarPreview}
            userId={user?.id}
            userName={user?.name}
            avatar={user?.avatar}
            onPick={() => fileInputRef.current?.click()}
          />
          <input ref={fileInputRef} type="file" accept="image/*" onChange={handleAvatarChange} className="hidden" />
          {avatarError && <p className="st-error">{avatarError}</p>}

          <div className="st-grid" style={{ gridTemplateColumns: compact ? "minmax(0, 1fr)" : undefined }}>
            <MacField label="name" required value={name} onChange={(v) => { setName(v); mark(); }} />
            <MacField label="email" value={user?.email || ""} disabled />
            <MacField label="location" value={location} onChange={(v) => { setLocation(v); mark(); }} />
          </div>

          <div>
            <div className="st-label st-label-row">
              <span>introduction</span>
              {firstRun && !lookupFoundNothing(firstRun.lookup) && (
                <button type="button" onClick={writeOwnIntro} className="pl-plain-btn st-link">not you? write your own</button>
              )}
            </div>
            <div className="st-well">
              <textarea id="intro" value={intro} rows={4} onChange={(e) => { setIntro(e.target.value); mark(); }} />
            </div>
          </div>

          <div>
            <h2 className="st-h">socials</h2>
            <div className="st-grid st-grid-tight" style={{ gridTemplateColumns: compact ? "minmax(0, 1fr)" : undefined }}>
              {[
                { prefix: "x.com/", label: "twitter", value: getSocial("twitter") },
                { prefix: "linkedin.com/in/", label: "linkedin", value: getSocial("linkedin") },
                { prefix: "github.com/", label: "github", value: getSocial("github") },
                { prefix: "t.me/", label: "telegram", value: getSocial("telegram") },
              ].map(({ prefix, label, value }) => (
                <label key={label} className="st-well st-prefixed">
                  <span className="st-prefix">{prefix}</span>
                  <input
                    value={value}
                    placeholder="username"
                    onChange={(e) => setSocial(label, e.target.value)}
                    onBlur={(e) => {
                      const resolved = parseSocial({ label, value: e.target.value });
                      const platform = label === "twitter" ? "x" : label;
                      setSocial(label, resolved.platform === platform ? resolved.handle : e.target.value.trim());
                    }}
                  />
                </label>
              ))}
              {customSocials.map((social, index) => (
                <label key={index} className="st-well st-prefixed">
                  <input
                    value={social.value}
                    placeholder="https://"
                    onChange={(e) => {
                      setSocials((prev) => prev.map((s) => s === social ? { label: "custom", value: e.target.value } : s));
                      mark();
                    }}
                  />
                  <button type="button" className="pl-plain-btn st-link st-remove" onClick={() => { setSocials((prev) => prev.filter((s) => s !== social)); mark(); }}>remove</button>
                </label>
              ))}
              {customSocials.length < 3 && (
                <button type="button" onClick={() => { setSocials((prev) => [...prev, { label: "custom", value: "" }]); mark(); }} className="wb-btn" style={{ justifySelf: "start", alignSelf: "center" }}>+ add website</button>
              )}
            </div>
          </div>

          {/* Deleting the account: settings only, not first-run setup. Same as deleting a network. */}
          {!firstRun && (
            <div className="st-danger">
              <button type="button" onClick={() => setIsDangerZoneExpanded((open) => !open)} aria-expanded={isDangerZoneExpanded} className="pl-plain-btn st-danger-toggle">
                <span aria-hidden>{isDangerZoneExpanded ? "▲" : "▼"}</span>
                delete my account
              </button>
              {isDangerZoneExpanded && (
                <div className="st-danger-box">
                  <p>index stops right away and every intent closes. connections you&apos;ve already made stay with the other person. type your email to confirm.</p>
                  <div className="st-well">
                    <input value={deleteConfirmationText} onChange={(e) => setDeleteConfirmationText(e.target.value)} placeholder={user?.email || "you@example.com"} />
                  </div>
                  <button type="button" disabled={deleteConfirmationText !== user?.email || isDeletingAccount} onClick={() => void handleDeleteAccount()} className="wb-btn danger" style={{ justifySelf: "end" }}>
                    {isDeletingAccount ? "deleting…" : "delete"}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {activeTab === "agents" && <AgentsPage embedded />}

      {activeTab === "access" && (
        <div className="st-stack">
          <ApiKeysSection />
          <DevicesSection />
        </div>
      )}

      {activeTab === "advanced" && <AdvancedPane signOut={signOut} />}

      {activeTab === "notifications" && (
        <div className="st-stack">
          <p className="st-note">index works in the background. choose what&apos;s worth interrupting you for.</p>
          <div>
            <label htmlFor="timezone" className="st-label">timezone</label>
            <div className="st-well">
              <select id="timezone" value={timezone} onChange={(e) => { setTimezone(e.target.value); mark(); }}>
                {Intl.supportedValuesOf("timeZone").map((tz) => (
                  <option key={tz} value={tz}>{tz.replace(/_/g, " ")}</option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <h2 className="st-h">tell me when</h2>
            <ul className="st-rows">
              {NOTIFY.map(({ key, title, body: text }) => (
                <li key={key}>
                  <label className="st-row">
                    <span className="st-row-text">
                      <b>{title}</b>
                      <span>{text}</span>
                    </span>
                    <input
                      type="checkbox"
                      checked={notificationPreferences[key] !== false}
                      onChange={(e) => { setNotificationPreferences((prev) => ({ ...prev, [key]: e.target.checked })); mark(); }}
                    />
                  </label>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </>
  );

  // Only the profile and notifications panes have anything to save.
  const savable = activeTab === "profile" || activeTab === "notifications";
  const saveLabel = saving ? "saving…" : firstRun ? "looks good →" : "save changes";

  // Signed in on desktop: the plain page, like Home, Intents and Networks.
  if (plain) {
    return (
      <div className="ih-view pl">
        <div className="pl-col">
          <PageHead title="settings" centered />
          <div className="pl-page pl-settings">
            <div className="pl-tabbar">
              <div className="pl-tabs" role="tablist">
                {SETTINGS_TABS.map((tab) => (
                  <button
                    key={tab}
                    type="button"
                    role="tab"
                    aria-selected={tab === activeTab}
                    className={tab === activeTab ? "on" : undefined}
                    onClick={() => navigate(tab === "profile" ? "/settings" : `/settings?tab=${tab}`)}
                  >{tab}</button>
                ))}
              </div>
            </div>
            <div className="st-body">{body}</div>
            {savable && (
              <div className="st-actions">
                <button type="button" onClick={() => resetForm(user)} disabled={saving || !isDirty} className="wb-btn">cancel</button>
                <button type="button" onClick={() => void handleSave()} disabled={saving || !!avatarError || !isDirty} className="wb-btn primary">{saveLabel}</button>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <Stage width={860} height="min(660px, calc(100vh - 112px))">
      <Window
        title={firstRun ? "getting started" : "settings"}
        // First run has nothing behind it to close back to, so the box signs out, as on the Mac.
        onClose={firstRun ? () => void signOut() : compact ? back : () => navigate("/")}
        style={{ height: "100%" }}
      >
        {firstRun && (
          <div style={{ padding: compact ? "12px 16px" : "14px 24px", borderBottom: "1px solid var(--wb-hairline)", fontFamily: "var(--mac-sans)", fontSize: 13, color: "var(--ink)", flex: "0 0 auto" }}>
            {lookupFoundNothing(firstRun.lookup)
              ? "i couldn't find anything public about you, so fill this in yourself. it's what your agent works from."
              : "here's what i pulled together. make sure it's right."}
          </div>
        )}
        <div className="mac-scroll" style={{ flex: 1, overflowY: "auto", padding: compact ? "14px 16px 22px" : "18px 24px 22px" }}>
          {!firstRun && (
            <div style={{ marginBottom: 18 }}>
              <SettingsTabs />
            </div>
          )}
          {body}
        </div>
        <div style={{
          borderTop: "1px solid var(--wb-hairline)", padding: "11px 24px",
          display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 10,
          flex: "0 0 auto", background: "#fff",
        }}>
          {/* First run, as on the Mac: reset restores the prefill, sign out
              leaves without committing, "looks good" is the only commit. */}
          {firstRun && isDirty && (
            <button type="button" onClick={() => resetForm(user)} disabled={saving} className="wb-btn" style={{ marginRight: "auto" }}>reset</button>
          )}
          {firstRun ? (
            <button type="button" onClick={() => void signOut()} disabled={saving} className="pl-plain-btn st-link">sign out</button>
          ) : (
            <button type="button" onClick={() => navigate("/")} disabled={saving} className="wb-btn">cancel</button>
          )}
          <button type="button" onClick={() => void handleSave()} disabled={saving || !!avatarError || confirmBlocked} className="wb-btn primary">{saveLabel}</button>
        </div>
      </Window>
    </Stage>
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
          <img src={preview} alt="" width={54} height={54} style={{ width: 54, height: 54, objectFit: "cover", display: "block", borderRadius: 3 }} />
        ) : (
          <UserAvatar id={userId} name={userName} avatar={avatar} size={54} />
        )}
        <span aria-hidden style={{
          position: "absolute", right: -1, bottom: -1, width: 16, height: 16,
          border: "1px solid var(--wb-control)", background: hot ? "var(--wb-hover-2)" : "#fff", color: hot ? "var(--ink)" : "var(--ink-2)",
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 10, lineHeight: 1, pointerEvents: "none", borderRadius: 3,
        }}>✎</span>
      </span>
      <div style={{ fontFamily: "var(--mac-sans)", fontSize: 16, fontWeight: 500, color: "var(--ink)" }}>{name}</div>
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
    <div className="st-stack">
      <div>
        <h2 className="st-h">protocol server</h2>
        <p className="st-note">
          requests go to <code>{active}</code>. switching signs you out. a session belongs to the server it was made on.
        </p>
        <div className="pl-q-options st-options" role="radiogroup">
          {[...PROTOCOL_PRESETS.map((item) => ({ value: item.value, label: item.label })), { value: "custom", label: "custom" }].map((option) => (
            <label key={option.value}>
              <input
                type="radio"
                name="protocol-server"
                checked={choice === option.value}
                onChange={() => {
                  setChoice(option.value);
                  const next = PROTOCOL_PRESETS.find((item) => item.value === option.value);
                  if (next) void apply(next.url);
                }}
              /> {option.label}
            </label>
          ))}
        </div>
        {choice === "custom" && (
          <div style={{ marginTop: 12, maxWidth: 360 }}>
            <div className="st-label">origin</div>
            <div className="st-well">
              <input
                value={custom}
                placeholder="https://protocol.example.com"
                onChange={(event) => setCustom(event.target.value)}
                onBlur={() => void apply(custom)}
                onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void apply(custom); } }}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function MacField({ label, value, onChange, disabled, required }: {
  label: string; value: string; onChange?: (value: string) => void; disabled?: boolean; required?: boolean;
}) {
  return (
    <div style={{ minWidth: 0 }}>
      <div className="st-label">
        {label}{required && <span style={{ color: "#8a8578", marginLeft: 4 }}>*</span>}
      </div>
      <div className={disabled ? "st-well off" : "st-well"}>
        <input value={value} disabled={disabled} onChange={(e) => onChange?.(e.target.value)} />
      </div>
    </div>
  );
}

export const Component = ProfilePage;
