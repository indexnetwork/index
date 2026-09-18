import { useEffect } from "react";

// Order matters: the bridge installs window.IndexApp / window.IndexApi as it
// evaluates, and the screens read those globals as they mount. ES modules run
// imports in source order, so the bridge is in place before the bundle loads.
import { setAuthHandlers, setAuthenticated } from "./bridge.web.mjs";
import WorkbenchApp from "./workbench.generated.jsx";

import { useAuthContext } from "@/contexts/AuthContext";

// The Workbench stylesheet is a whole-document theme — it restyles `body`, sets
// `overflow:hidden` and resets every element — so it cannot join the app's CSS
// bundle, where it would outlive this route. `?inline` keeps it out of the
// bundle and hands it over as text; the effect below puts it in a <style> tag
// for exactly as long as the route is mounted. Its two webfonts ride along:
// assemble.py inlines them as data URIs for the offline WKWebView bundle, Vite
// fingerprints them and rewrites the url()s while processing this import.
import amigaCss from "./assets/amiga.css?inline";

function Workbench() {
  const { isReady, isAuthenticated, openLoginModal, signOut } = useAuthContext();

  // Sign-in and sign-out are the site's, not a browser handshake to a native
  // Keychain: the Workbench's own sign-in screen calls through to the same modal
  // every other route uses, and lands back here.
  useEffect(() => {
    setAuthHandlers({
      login: () => openLoginModal("/web"),
      logout: () => { void signOut(); },
    });
  }, [openLoginModal, signOut]);

  // The screens gate on a boolean the bridge owns (Swift's contract: session
  // state, never credential material). Hold it back until AuthContext has
  // settled, so a signed-in reload does not flash the sign-in screen.
  useEffect(() => {
    if (!isReady) return;
    setAuthenticated(isAuthenticated);
  }, [isReady, isAuthenticated]);

  useEffect(() => {
    const style = document.createElement("style");
    style.dataset.workbench = "true";
    style.textContent = amigaCss;
    document.head.appendChild(style);
    return () => style.remove();
  }, []);

  // The screens are written for a window they fill: the mac shell gives them a
  // full-height #root, this gives them the viewport.
  return (
    <div style={{ position: "fixed", inset: 0, overflow: "hidden" }}>
      <WorkbenchApp />
    </div>
  );
}

export const Component = Workbench;
