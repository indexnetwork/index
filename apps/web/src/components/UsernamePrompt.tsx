import { useState } from "react";
import { useLocation } from "react-router";

import { useAuthContext } from "@/contexts/AuthContext";
import { useAuth } from "@/contexts/APIContext";
import { APIError } from "@/lib/api";
import { needsOnboarding } from "@/services/onboarding";

/** A starting suggestion from the display name, in the alphabet usernames allow. */
function suggestFromName(name: string | undefined): string {
  return (name ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/[\s-]+/g, "-")
    .slice(0, 30);
}

/**
 * Every account holds one username. Anyone signed in without one is asked
 * once, here, and cannot dismiss it; saving one is what makes it go away for
 * good. Onboarding is left alone: the first-run profile form has its own
 * username field, and this only asks afterwards if that was left blank.
 */
export default function UsernamePrompt() {
  const { user, isAuthenticated, refetchUser } = useAuthContext();
  const authService = useAuth();
  const { pathname } = useLocation();
  const [username, setUsername] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isAuthenticated || !user?.id || user.username || needsOnboarding(user) || pathname.startsWith("/onboarding")) {
    return null;
  }

  const value = username ?? suggestFromName(user.name);
  const ready = value.length >= 3 && !saving;

  const save = async () => {
    if (!ready) return;
    setSaving(true);
    setError(null);
    try {
      await authService.updateProfile({ username: value });
      await refetchUser();
    } catch (err) {
      // 400 is a rule it broke, 409 is someone else holding it; both read as written.
      setError(err instanceof APIError && (err.status === 400 || err.status === 409) ? err.message : "Couldn't save your username");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="workbench" style={{ position: "fixed", inset: 0, zIndex: 120, display: "grid", gridTemplateColumns: "minmax(0, 1fr)", placeItems: "center", background: "rgba(0,30,70,0.55)", padding: 16 }}>
      <form
        className="amiga-window"
        style={{ width: 420, maxWidth: "100%" }}
        onSubmit={(e) => { e.preventDefault(); void save(); }}
      >
        <div className="mac-titlebar">
          <span className="mac-title"><span className="t">pick a username</span></span>
        </div>
        <div className="wb-body" style={{ padding: 18, gap: 12 }}>
          <p style={{ margin: 0, fontFamily: "var(--mac-sans)", fontSize: 13, lineHeight: 1.5 }}>
            it&apos;s your link on index, and it&apos;s yours alone. you can change it later in your profile.
          </p>
          <div style={{ border: "1px solid #000", background: "#fff", boxShadow: "inset 1px 1px 0 var(--ink-3), inset -1px -1px 0 #fff", padding: "7px 10px", display: "flex", alignItems: "center", gap: 2 }}>
            <span style={{ fontFamily: "var(--mac-sans)", fontSize: 13, color: "var(--ink-2)" }}>@</span>
            <input
              autoFocus
              value={value}
              placeholder="yourname"
              aria-label="username"
              autoComplete="off"
              data-1p-ignore
              // Same alphabet the server accepts: lowercase letters, numbers, hyphens.
              onChange={(e) => { setUsername(e.target.value.toLowerCase().replace(/^@/, "").replace(/[^a-z0-9-]/g, "")); setError(null); }}
              style={{ flex: 1, minWidth: 0, background: "transparent", border: "none", outline: "none", fontFamily: "var(--mac-sans)", fontSize: 13 }}
            />
          </div>
          <div style={{ fontFamily: "var(--mac-mono)", fontSize: 11, color: error ? "var(--ink-warn)" : "var(--ink-2)" }}>
            {error ?? `${window.location.host}/${value || "yourname"}`}
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <button type="submit" className="wb-btn primary" disabled={!ready}>
              {saving ? "saving…" : "save"}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
