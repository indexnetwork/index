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

async function postSubscribe(email: string, type: "waitlist" | "newsletter") {
  return fetch(apiUrl("/api/subscribe"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, type }),
  });
}

/**
 * Request-access signup (POST /api/subscribe, type "waitlist").
 * Optional monthly updates toggle posts type "newsletter" as well.
 */
export function WaitlistForm({ idPrefix, header, successAction, onStatusChange }: Props) {
  const [email, setEmail] = useState("");
  const [monthlyUpdates, setMonthlyUpdates] = useState(true);
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
      const waitlistRes = await postSubscribe(email, "waitlist");
      if (!waitlistRes.ok) {
        setStatus("error");
        return;
      }
      if (monthlyUpdates) {
        await postSubscribe(email, "newsletter");
      }
      setStatus("success");
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
          We&rsquo;ll be in touch when the next cycle opens.
          {monthlyUpdates ? " Monthly updates are on." : ""}
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

        <label className="landing-modal-toggle" htmlFor={`${idPrefix}-updates`}>
          <input
            id={`${idPrefix}-updates`}
            type="checkbox"
            checked={monthlyUpdates}
            onChange={(e) => setMonthlyUpdates(e.target.checked)}
            disabled={status === "loading"}
          />
          <span className="landing-modal-toggle-label">Get monthly notes from the team</span>
        </label>

        {status === "error" && (
          <p className="landing-modal-error">
            Something went wrong. Please try again.
          </p>
        )}
        <button
          type="submit"
          className="landing-modal-submit is-primary"
          disabled={status === "loading"}
        >
          {status === "loading" ? "Submitting…" : "Request Access"}
        </button>
      </form>
    </>
  );
}
