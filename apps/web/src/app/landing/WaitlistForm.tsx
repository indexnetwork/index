import { useState, type ReactNode } from "react";
import { apiUrl } from "@/lib/api";

export type SubscribeStatus = "idle" | "loading" | "success" | "error";

type Props = {
  idPrefix: string;
  /** Rendered above the form; hidden once submission succeeds. */
  header?: ReactNode;
  /** Rendered inside the success block (e.g. a close button). */
  successAction?: ReactNode;
  onStatusChange?: (status: SubscribeStatus) => void;
};

/**
 * Waitlist signup form (POST /api/subscribe, type "waitlist").
 * Shared between the landing waitlist modal and the /waitlist page.
 */
export function WaitlistForm({ idPrefix, header, successAction, onStatusChange }: Props) {
  const [email, setEmail] = useState("");
  const [status, setStatusState] = useState<SubscribeStatus>("idle");

  const setStatus = (s: SubscribeStatus) => {
    setStatusState(s);
    onStatusChange?.(s);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) return;
    setStatus("loading");
    try {
      const res = await fetch(apiUrl("/api/subscribe"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, type: "waitlist" }),
      });
      setStatus(res.ok ? "success" : "error");
    } catch {
      setStatus("error");
    }
  };

  if (status === "success") {
    return (
      <div className="landing-modal-success">
        <h3 id={`${idPrefix}-title`} className="landing-modal-title">
          you&rsquo;re on the list
        </h3>
        <p className="landing-modal-lede">
          Check your inbox for your welcome email.
        </p>
        {successAction}
      </div>
    );
  }

  return (
    <>
      {header}
      <form onSubmit={submit} className="landing-modal-form">
        <label htmlFor={`${idPrefix}-email`} className="landing-modal-label">
          Email <span className="landing-modal-req">*</span>
        </label>
        <input
          id={`${idPrefix}-email`}
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="landing-modal-input"
          required
          disabled={status === "loading"}
          autoFocus
        />

        {status === "error" && (
          <p className="landing-modal-error">
            Something went wrong. Please try again.
          </p>
        )}
        <button
          type="submit"
          className="landing-modal-submit"
          disabled={status === "loading"}
        >
          {status === "loading" ? "Submitting…" : "Join the waitlist"}
        </button>
      </form>
    </>
  );
}
