const KEY = "index.protocol";

/** A bare http(s) origin, never a path. */
export function isProtocolOrigin(value: string) {
  return /^https?:\/\/[^/\s]+$/.test(value.trim().replace(/\/+$/, ""));
}

export function storedProtocolOrigin() {
  try {
    const value = (localStorage.getItem(KEY) || "").trim().replace(/\/+$/, "");
    return isProtocolOrigin(value) ? value : "";
  } catch {
    return "";
  }
}

/** The protocol origin requests use. A saved choice wins over the build. */
export function protocolOrigin() {
  return storedProtocolOrigin() || String(import.meta.env.VITE_PROTOCOL_URL || "").replace(/\/+$/, "");
}

export function rememberProtocolOrigin(origin: string) {
  localStorage.setItem(KEY, origin.trim().replace(/\/+$/, ""));
}

export function forgetProtocolOrigin() {
  localStorage.removeItem(KEY);
}

/** What the settings pane shows, including the local dev server the proxy hides. */
export function visibleProtocolOrigin() {
  const chosen = protocolOrigin();
  if (chosen) return chosen;
  const host = window.location.hostname;
  if (host === "localhost" || host === "127.0.0.1") return "http://localhost:3001";
  if (host === "dev.index.network") return "https://protocol.dev.index.network";
  if (host === "index.network" || host === "www.index.network") return "https://protocol.index.network";
  return window.location.origin;
}
