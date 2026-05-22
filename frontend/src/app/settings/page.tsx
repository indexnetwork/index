import { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { Link } from "react-router";
import * as Tabs from "@radix-ui/react-tabs";
import * as AlertDialog from "@radix-ui/react-alert-dialog";
import { Loader2, Camera, ArrowUpRight, Trash2, Sparkles, ChevronDown, ChevronRight, MessageCircle } from "lucide-react";
import { useAuthContext } from "@/contexts/AuthContext";
import { useAuth } from "@/contexts/APIContext";
import { useNotifications } from "@/contexts/NotificationContext";
import UserAvatar from "@/components/UserAvatar";
import { validateFiles } from "@/lib/file-validation";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import ClientLayout from "@/components/ClientLayout";
import { ContentContainer } from "@/components/layout";
import { SaveBarProvider } from "@/contexts/SaveBarContext";
import AgentApiKeysSection from "@/components/settings/AgentApiKeysSection";
import { useIntegrationsService } from "@/services/integrations";

const SETTINGS_TABS = ["profile", "notifications", "api-keys"] as const;
type SettingsTab = (typeof SETTINGS_TABS)[number];

function isSettingsTab(v: string | null): v is SettingsTab {
  return v !== null && (SETTINGS_TABS as readonly string[]).includes(v);
}

export default function ProfilePage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
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
    weeklyNewsletter: true,
  });

  const tabParam = searchParams.get("tab");
  const activeTab: SettingsTab = isSettingsTab(tabParam) ? tabParam : "profile";

  const setActiveTab = (v: string) => {
    if (!isSettingsTab(v)) return;
    if (v === "profile") {
      setSearchParams({}, { replace: true });
    } else {
      setSearchParams({ tab: v }, { replace: true });
    }
  };
  const [saving, setSaving] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const [generatingIntro, setGeneratingIntro] = useState(false);

  const [isDangerZoneExpanded, setIsDangerZoneExpanded] = useState(false);
  const [showDeleteConfirmation, setShowDeleteConfirmation] = useState(false);
  const [deleteConfirmationText, setDeleteConfirmationText] = useState("");
  const [isDeletingAccount, setIsDeletingAccount] = useState(false);

  const integrationsService = useIntegrationsService();
  const [telegramConnected, setTelegramConnected] = useState(false);
  const [telegramConnecting, setTelegramConnecting] = useState(false);
  const [telegramDisconnecting, setTelegramDisconnecting] = useState(false);
  const [telegramUserId, setTelegramUserId] = useState<string | null>(null);

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
      u.notificationPreferences || { connectionUpdates: true, weeklyNewsletter: true }
    );
    setAvatarFile(null);
    setAvatarPreview(null);
    setAvatarError(null);
    setIsDirty(false);
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally runs only when user changes; state setters are stable
  useEffect(() => { resetForm(user); }, [user]); // eslint-disable-line react-hooks/set-state-in-effect -- resetForm mirrors server-fetched user into editable form fields; legitimate sync-from-external-state pattern.

  useEffect(() => {
    if (!isAuthenticated) return;
    integrationsService.getConnections().then(({ connections }) => {
      const tg = connections.find(c => c.toolkit === 'telegram' && c.status === 'active');
      setTelegramConnected(!!tg);
      setTelegramUserId(tg ? tg.id : null);
    }).catch(() => { /* ignore -- non-critical */ });
  }, [isAuthenticated, integrationsService]);

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
        timezone: timezone || undefined,
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

  const handleGenerateIntro = async () => {
    setGeneratingIntro(true);
    try {
      const generated = await authService.generateIntro();
      if (generated) {
        setIntro(generated);
        mark();
      } else {
        error("Couldn't generate an intro — try adding your socials or a full name first.");
      }
    } catch {
      error("Failed to generate intro");
    } finally {
      setGeneratingIntro(false);
    }
  };

  const handleConnectTelegram = async () => {
    setTelegramConnecting(true);
    try {
      const response = await integrationsService.connect('telegram') as unknown as { deepLink: string };
      if (response.deepLink) {
        window.open(response.deepLink, '_blank');
        // Poll for connection status after the user opens Telegram
        const poll = setInterval(async () => {
          try {
            const { connections } = await integrationsService.getConnections();
            const tg = connections.find(c => c.toolkit === 'telegram' && c.status === 'active');
            if (tg) {
              clearInterval(poll);
              setTelegramConnected(true);
              setTelegramUserId(tg.id);
              setTelegramConnecting(false);
              success('Telegram connected');
            }
          } catch { /* ignore polling errors */ }
        }, 3000);
        // Stop polling after 2 minutes
        setTimeout(() => { clearInterval(poll); setTelegramConnecting(false); }, 120_000);
      }
    } catch {
      error('Failed to connect Telegram');
      setTelegramConnecting(false);
    }
  };

  const handleDisconnectTelegram = async () => {
    if (!telegramUserId) return;
    setTelegramDisconnecting(true);
    try {
      await integrationsService.disconnect(telegramUserId);
      setTelegramConnected(false);
      setTelegramUserId(null);
      success('Telegram disconnected');
    } catch {
      error('Failed to disconnect Telegram');
    } finally {
      setTelegramDisconnecting(false);
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
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
        </div>
      </ClientLayout>
    );
  }


  return (
    <SaveBarProvider visible={isDirty}>
      <ClientLayout>
        <div className="px-6 lg:px-8 py-8">
        <ContentContainer>
          <h1 className="text-2xl font-bold text-black font-ibm-plex-mono mb-8">Settings</h1>

          <Tabs.Root value={activeTab} onValueChange={setActiveTab}>
            <Tabs.List className="flex flex-wrap gap-x-1 border-b border-gray-200 mb-8">
              {([
                ["profile", "Profile Settings"],
                ["notifications", "Notification Settings"],
                ["api-keys", "API Keys"],
              ] as const).map(([value, label]) => (
                <Tabs.Trigger
                  key={value}
                  value={value}
                  className="px-4 py-2 text-sm text-gray-600 border-b-2 border-transparent outline-none data-[state=active]:border-black data-[state=active]:text-black data-[state=active]:font-bold focus-visible:ring-2 focus-visible:ring-gray-400 focus-visible:ring-offset-2"
                >
                  {label}
                </Tabs.Trigger>
              ))}
            </Tabs.List>

            <Tabs.Content value="profile">
          <div className="space-y-10">

            {/* Identity header */}
            <div className="flex items-center gap-5">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="relative flex-shrink-0 group cursor-pointer"
              >
                <div className="w-[72px] h-[72px] rounded-full overflow-hidden bg-gray-100">
                  {avatarPreview ? (
                    <img
                      src={avatarPreview}
                      alt={user?.name || "Avatar"}
                      width={72}
                      height={72}
                      loading="lazy"
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <UserAvatar id={user?.id} name={user?.name} avatar={user?.avatar} size={72} />
                  )}
                </div>
                <div className="absolute inset-0 rounded-full bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity duration-150 flex items-center justify-center">
                  <Camera className="w-4 h-4 text-white" />
                </div>
              </button>
              <input ref={fileInputRef} type="file" accept="image/*" onChange={handleAvatarChange} className="hidden" />

              <div className="min-w-0">
                <div className="font-semibold text-gray-900 font-ibm-plex-mono truncate leading-tight">
                  {name || user?.name || "Your name"}
                </div>
                {user?.id && (
                  <Link
                    to={`/u/${user.id}`}
                    className="inline-flex items-center gap-1 text-xs text-gray-400 hover:text-black transition-colors duration-150 mt-1"
                  >
                    View public profile
                    <ArrowUpRight className="w-3 h-3" />
                  </Link>
                )}
              </div>
            </div>
            {avatarError && <p className="text-sm text-red-500 -mt-6">{avatarError}</p>}

            {/* Public Profile */}
            <div className="space-y-4 pt-2 border-t border-gray-100">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider font-ibm-plex-mono pt-4">
                Public Profile
              </p>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label htmlFor="name" className="text-sm font-medium font-ibm-plex-mono text-gray-700 block mb-1.5">
                    Name <span className="text-gray-400">*</span>
                  </label>
                  <Input
                    id="name"
                    value={name}
                    onChange={(e) => { setName(e.target.value); mark(); }}
                    placeholder="John Doe"
                    required
                  />
                </div>
                <div>
                  <label htmlFor="email" className="text-sm font-medium font-ibm-plex-mono text-gray-700 block mb-1.5">
                    Email
                  </label>
                  <Input
                    id="email"
                    value={user?.email || ''}
                    readOnly
                    className="bg-gray-50 text-gray-400 cursor-default"
                  />
                </div>
                <div>
                  <label htmlFor="location" className="text-sm font-medium font-ibm-plex-mono text-gray-700 block mb-1.5">
                    Location
                  </label>
                  <Input
                    id="location"
                    value={location}
                    onChange={(e) => { setLocation(e.target.value); mark(); }}
                    placeholder="Brooklyn, NY"
                  />
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label htmlFor="intro" className="text-sm font-medium font-ibm-plex-mono text-gray-700">
                    Introduction
                  </label>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={handleGenerateIntro}
                      disabled={generatingIntro}
                      title="Generate with AI"
                      className="flex items-center gap-1 text-xs text-gray-400 hover:text-black transition-colors duration-150 disabled:opacity-40"
                    >
                      {generatingIntro ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Sparkles className="w-3.5 h-3.5" />
                      )}
                      <span>{generatingIntro ? "Generating..." : intro ? "Regenerate" : "Generate"}</span>
                    </button>
                    <span className="text-xs text-gray-400">{intro.length}/500</span>
                  </div>
                </div>
                <Textarea
                  id="intro"
                  value={intro}
                  onChange={(e) => { setIntro(e.target.value); mark(); }}
                  className="min-h-[80px] resize-none [field-sizing:content]"
                  placeholder="Tell others about yourself..."
                  maxLength={500}
                />
              </div>
            </div>

            {/* Socials */}
            <div className="space-y-2.5 border-t border-gray-100">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider font-ibm-plex-mono pt-4 mb-4">
                Socials
              </p>

              {[
                { prefix: "x.com/", label: "twitter", value: getSocial('twitter'), onChange: (v: string) => setSocial('twitter', v) },
                { prefix: "linkedin.com/in/", label: "linkedin", value: getSocial('linkedin'), onChange: (v: string) => setSocial('linkedin', v) },
                { prefix: "github.com/", label: "github", value: getSocial('github'), onChange: (v: string) => setSocial('github', v) },
                { prefix: "t.me/", label: "telegram", value: getSocial('telegram'), onChange: (v: string) => setSocial('telegram', v) },
              ].map(({ prefix, value, onChange }) => (
                <div key={prefix} className="flex items-center border border-gray-200 rounded-sm hover:border-gray-400 focus-within:border-gray-900 transition-colors duration-150">
                  <span className="px-3 py-2 bg-gray-50 text-gray-400 font-ibm-plex-mono text-xs border-r border-gray-200 whitespace-nowrap select-none">
                    {prefix}
                  </span>
                  <Input
                    value={value}
                    onChange={(e) => onChange(e.target.value)}
                    className="flex-1 border-0 hover:border-0 focus:border-0 focus-visible:ring-0 focus-visible:ring-offset-0 text-sm"
                  />
                </div>
              ))}

              {customSocials.map((social, index) => (
                <div key={index} className="flex items-center border border-gray-200 rounded-sm hover:border-gray-400 focus-within:border-gray-900 transition-colors duration-150">
                  <Input
                    value={social.value}
                    onChange={(e) => {
                      setSocials(prev => prev.map(s => s === social ? { label: 'custom', value: e.target.value } : s));
                      mark();
                    }}
                    placeholder="https://example.com"
                    className="flex-1 border-0 hover:border-0 focus:border-0 focus-visible:ring-0 focus-visible:ring-offset-0 text-sm"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      setSocials(prev => prev.filter(s => s !== social));
                      mark();
                    }}
                    className="px-3 py-2 text-gray-400 hover:text-red-500 transition-colors border-l border-gray-200"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}

              {customSocials.length < 3 && (
                <button
                  type="button"
                  onClick={() => { setSocials(prev => [...prev, { label: 'custom', value: '' }]); mark(); }}
                  className="w-full flex items-center justify-center px-3 py-2 border border-dashed border-gray-200 rounded-sm text-gray-400 hover:border-gray-400 hover:text-gray-600 hover:bg-gray-50 transition-colors duration-150 text-sm"
                >
                  + Add website
                </button>
              )}
            </div>

            {/* Integrations */}
            <div className="space-y-2.5 border-t border-gray-100">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider font-ibm-plex-mono pt-4 mb-4">
                Integrations
              </p>

              <div className="flex items-center justify-between p-3 border border-gray-200 rounded-sm">
                <div className="flex items-center gap-3">
                  <MessageCircle className="w-5 h-5 text-gray-500" />
                  <div>
                    <p className="text-sm font-medium font-ibm-plex-mono text-gray-700">Telegram</p>
                    <p className="text-xs text-gray-400 mt-0.5">
                      {telegramConnected
                        ? "Your Telegram account is connected"
                        : "Receive notifications and updates via Telegram"}
                    </p>
                  </div>
                </div>
                {telegramConnected ? (
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-green-600 font-medium font-ibm-plex-mono">Connected &#x2713;</span>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleDisconnectTelegram}
                      disabled={telegramDisconnecting}
                      className="text-gray-500 hover:text-red-600 hover:border-red-200"
                    >
                      {telegramDisconnecting ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        "Disconnect"
                      )}
                    </Button>
                  </div>
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleConnectTelegram}
                    disabled={telegramConnecting}
                  >
                    {telegramConnecting ? (
                      <>
                        <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
                        Waiting...
                      </>
                    ) : (
                      "Connect"
                    )}
                  </Button>
                )}
              </div>
            </div>

            {/* Danger Zone */}
            <div className="pt-6 border-t border-gray-100">
              <button
                type="button"
                onClick={() => setIsDangerZoneExpanded(!isDangerZoneExpanded)}
                className="flex items-center gap-2 text-xs font-semibold text-red-600 uppercase tracking-wider font-ibm-plex-mono hover:text-red-700 transition-colors duration-150 pt-4"
              >
                {isDangerZoneExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                Danger Zone
              </button>
              {isDangerZoneExpanded && (
                <div className="mt-3 flex items-center justify-between p-3 border border-red-200 rounded-sm bg-red-50">
                  <div>
                    <p className="text-sm font-medium text-red-600">Delete your account</p>
                    <p className="text-xs text-red-600/70 mt-1">This action cannot be undone.</p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => { setDeleteConfirmationText(""); setShowDeleteConfirmation(true); }}
                    className="border-red-200 text-red-600 hover:bg-red-100"
                  >
                    <Trash2 className="h-4 w-4 mr-1" /> Delete
                  </Button>
                </div>
              )}
            </div>

          </div>
            </Tabs.Content>

            <Tabs.Content value="api-keys">
              <AgentApiKeysSection />
            </Tabs.Content>

            <Tabs.Content value="notifications">
              <div className="space-y-10">
                <div className="space-y-4">
                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider font-ibm-plex-mono">
                    Notifications
                  </p>
                  <div>
                    <label htmlFor="timezone" className="text-sm font-medium font-ibm-plex-mono text-gray-700 block mb-1.5">
                      Timezone
                    </label>
                    <div className="relative">
                      <select
                        id="timezone"
                        value={timezone}
                        onChange={(e) => { setTimezone(e.target.value); mark(); }}
                        className="flex h-10 w-full rounded-sm border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 transition-colors duration-150 hover:border-gray-400 focus:border-gray-900 focus:outline-none focus:ring-0 appearance-none cursor-pointer"
                      >
                        {Intl.supportedValuesOf("timeZone").map((tz) => (
                          <option key={tz} value={tz}>{tz.replace(/_/g, " ")}</option>
                        ))}
                      </select>
                      <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-gray-400">
                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="m6 9 6 6 6-6" />
                        </svg>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-2.5 pt-2 border-t border-gray-100">
                    <p className="text-xs text-gray-400 font-ibm-plex-mono mb-1">
                      Choose which emails you&apos;d like to receive.
                    </p>
                    {[
                      {
                        key: "connectionUpdates" as const,
                        label: "Connection updates",
                        description: "Email when someone connects with you",
                      },
                      {
                        key: "weeklyNewsletter" as const,
                        label: "Weekly newsletter",
                        description: "Weekly summary of new connections",
                      },
                    ].map(({ key, label, description }) => (
                      <label
                        key={key}
                        className="flex items-center justify-between p-3 border border-gray-200 rounded-sm cursor-pointer hover:bg-gray-50 transition-colors duration-150"
                      >
                        <div>
                          <p className="text-sm font-medium font-ibm-plex-mono text-gray-700">{label}</p>
                          <p className="text-xs text-gray-400 mt-0.5 font-ibm-plex-mono">{description}</p>
                        </div>
                        <input
                          type="checkbox"
                          checked={notificationPreferences[key]}
                          onChange={(e) => {
                            setNotificationPreferences((prev) => ({ ...prev, [key]: e.target.checked }));
                            mark();
                          }}
                          className="w-4 h-4 accent-black"
                        />
                      </label>
                    ))}
                  </div>
                </div>
              </div>
            </Tabs.Content>
          </Tabs.Root>

        </ContentContainer>
      </div>

      {/* Sticky save bar */}
      {isDirty && (
        <div className="fixed bottom-0 left-0 right-0 lg:left-64 bg-white border-t border-gray-200 z-40 px-6 lg:px-8">
          <div className="max-w-3xl mx-auto py-3 grid grid-cols-1 sm:grid-cols-2 gap-4 items-center">
            <span className="text-sm text-gray-500">You have unsaved changes</span>
            <div className="flex items-center gap-2 justify-self-end">
              <Button variant="outline" onClick={handleDiscard} disabled={saving}>
                Discard
              </Button>
              <Button onClick={handleSave} disabled={saving || !!avatarError}>
                {saving ? "Saving..." : "Save Changes"}
              </Button>
            </div>
          </div>
        </div>
      )}
      <AlertDialog.Root open={showDeleteConfirmation} onOpenChange={setShowDeleteConfirmation}>
        <AlertDialog.Portal>
          <AlertDialog.Overlay className="fixed inset-0 bg-black/50 z-[100]" />
          <AlertDialog.Content className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-white rounded-sm shadow-lg p-6 w-full max-w-md z-[100] focus:outline-none">
            <AlertDialog.Title className="text-lg font-bold text-gray-900 mb-4">Delete your account</AlertDialog.Title>
            <AlertDialog.Description className="text-sm text-gray-600 mb-4">
              This action cannot be undone. Type your email address to confirm.
            </AlertDialog.Description>
            <Input
              value={deleteConfirmationText}
              onChange={(e) => setDeleteConfirmationText(e.target.value)}
              placeholder={user?.email || "your@email.com"}
              className="mb-4"
            />
            <div className="flex justify-end gap-3">
              <AlertDialog.Cancel asChild>
                <Button variant="outline" disabled={isDeletingAccount}>Cancel</Button>
              </AlertDialog.Cancel>
              <Button
                onClick={handleDeleteAccount}
                disabled={isDeletingAccount || deleteConfirmationText !== user?.email}
                className="bg-red-600 hover:bg-red-700 text-white"
              >
                {isDeletingAccount ? "Deleting..." : "Delete"}
              </Button>
            </div>
          </AlertDialog.Content>
        </AlertDialog.Portal>
      </AlertDialog.Root>
      </ClientLayout>
    </SaveBarProvider>
  );
}

export const Component = ProfilePage;
