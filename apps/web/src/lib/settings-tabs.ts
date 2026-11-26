/**
 * Settings' panes, each at its own path: /settings/<tab>, the same shape as a
 * network's /networks/<id>/<tab>. Bare /settings opens the default pane.
 */
export const SETTINGS_TABS = ["agents", "notifications", "access", "advanced"] as const;
export type SettingsTab = (typeof SETTINGS_TABS)[number];
export const DEFAULT_SETTINGS_TAB: SettingsTab = "notifications";

export function isSettingsTab(value: string | null | undefined): value is SettingsTab {
  return value != null && (SETTINGS_TABS as readonly string[]).includes(value);
}

export function settingsPath(tab: SettingsTab = DEFAULT_SETTINGS_TAB): string {
  return `/settings/${tab}`;
}

/**
 * Where an old settings link belongs now. `?tab=<pane>` moves to its path, the
 * old profile tab to the profile editor, and an email-change return (sent to
 * `?tab=access&emailChange=1` by earlier links) to the editor that shows its
 * result. Null when the link is already current.
 */
export function legacySettingsRedirect(pathTab: string | undefined, search: URLSearchParams): string | null {
  const tab = search.get("tab");
  if (search.get("emailChange") === "1") {
    const rest = new URLSearchParams(search);
    rest.delete("tab");
    return `/profile/edit?${rest.toString()}`;
  }
  if (tab === "profile") return "/profile/edit";
  if (pathTab === undefined) return settingsPath(isSettingsTab(tab) ? tab : DEFAULT_SETTINGS_TAB);
  if (!isSettingsTab(pathTab)) return settingsPath();
  if (tab !== null) return settingsPath(pathTab);
  return null;
}
