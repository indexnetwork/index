/**
 * Where a new account was headed before first run took over: the network it
 * just joined, the chat a link opened, the page it signed in for. First run
 * ends on the home page, which takes this and goes on. It has to outlive
 * sign-in in another tab and the onboarding steps, so it lives in localStorage.
 */
const KEY = "index.afterFirstRun";
/** Long enough for sign-up and onboarding; older trips are forgotten. */
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/** Only same-origin app paths, never home itself. */
function usable(path: string | null | undefined): path is string {
  return !!path && path.startsWith("/") && !path.startsWith("//") && path !== "/"
    && !path.startsWith("/onboarding") && !path.startsWith("/login");
}

export function rememberAfterFirstRun(path: string): void {
  if (!usable(path)) return;
  try {
    localStorage.setItem(KEY, JSON.stringify({ path, at: Date.now() }));
  } catch {
    // Private mode can refuse storage; they land on home instead.
  }
}

/** The saved destination, if it's still fresh. Reading leaves it; clear it once you go. */
export function readAfterFirstRun(): string | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const saved = JSON.parse(raw) as { path?: string; at?: number };
    if (usable(saved?.path) && saved.at && Date.now() - saved.at <= MAX_AGE_MS) return saved.path;
    localStorage.removeItem(KEY);
    return null;
  } catch {
    return null;
  }
}

export function clearAfterFirstRun(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // Nothing to clear.
  }
}
