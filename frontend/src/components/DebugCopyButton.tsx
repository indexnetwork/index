import { useState, useCallback } from "react";
import { Bug, Check, X, Loader2 } from "lucide-react";

import { apiClient } from "@/lib/api";

interface DebugCopyButtonProps {
  /** API path to fetch debug data from (e.g. "/debug/intents/abc123") */
  fetchPath: string;
  /** Optional tooltip override */
  title?: string;
  /** Optional size class for the icon (default: "w-4 h-4") */
  iconSize?: string;
}

/**
 * A reusable button that fetches debug JSON from the API and copies it to the clipboard.
 * Shows a bug icon by default, a loading spinner while fetching, a green checkmark on success,
 * or a red X on error.
 */
export function DebugCopyButton({
  fetchPath,
  title = "Copy debug JSON",
  iconSize = "w-4 h-4",
}: DebugCopyButtonProps) {
  const [state, setState] = useState<"idle" | "loading" | "copied" | "error">("idle");

  const handleClick = useCallback(async () => {
    if (state === "loading") return;
    setState("loading");
    try {
      const data = await apiClient.get(fetchPath);
      await navigator.clipboard.writeText(JSON.stringify(data, null, 2));
      setState("copied");
      setTimeout(() => setState("idle"), 2000);
    } catch {
      setState("error");
      setTimeout(() => setState("idle"), 2000);
    }
  }, [fetchPath, state]);

  if (!import.meta.env.DEV && import.meta.env.VITE_ENABLE_DEBUG !== "true") return null;

  const icon = {
    idle: <Bug className={iconSize} />,
    loading: <Loader2 className={`${iconSize} animate-spin`} />,
    copied: <Check className={`${iconSize} text-green-500`} />,
    error: <X className={`${iconSize} text-red-500`} />,
  }[state];

  const label = {
    idle: title,
    loading: "Loading...",
    copied: "Copied!",
    error: "Failed to copy",
  }[state];

  return (
    <button
      type="button"
      onClick={handleClick}
      title={label}
      className="shrink-0 p-1 rounded text-gray-500 hover:text-[#4091BB] hover:bg-gray-100 focus:outline-none"
      aria-label={label}
    >
      {icon}
    </button>
  );
}
