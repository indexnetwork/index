import { useEffect, useState, type ReactNode } from "react";
import { agentPrompt } from "@/lib/agent-prompt";

/** Copies a prompt for the visitor's own agent. Defaults to the Index setup prompt. */
export default function CopyPromptButton({ className, icon, label, text }: { className: string; icon?: ReactNode; label: string; text?: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(t);
  }, [copied]);
  return (
    <button
      type="button"
      className={className}
      onClick={() => { void navigator.clipboard?.writeText(text ?? agentPrompt()).then(() => setCopied(true)); }}
    >
      {icon}
      <span aria-live="polite">{copied ? "Copied, paste it to your agent" : label}</span>
    </button>
  );
}
