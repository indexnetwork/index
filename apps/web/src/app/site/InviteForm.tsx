import { useState, type FormEvent } from "react";
import { apiUrl } from "@/lib/api";

type Status = "idle" | "loading" | "success" | "error";

/**
 * Email field and "Request your invite" button joined into one control.
 * Joins the waitlist (POST /api/subscribe, type "waitlist").
 */
export default function InviteForm({ autoFocus = false }: { autoFocus?: boolean } = {}) {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<Status>("idle");

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!email || status === "loading") return;
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
    return <p className="site-invite-done">You&rsquo;re on the list. We&rsquo;ll be in touch.</p>;
  }

  return (
    <>
      <form className="site-invite" onSubmit={submit} noValidate>
        <input
          type="email"
          className="site-invite-input"
          placeholder="you@domain.com"
          aria-label="Email address"
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
            if (status === "error") setStatus("idle");
          }}
          disabled={status === "loading"}
          autoFocus={autoFocus}
          required
        />
        <button type="submit" className="site-btn" disabled={status === "loading"}>
          {status === "loading" ? "Sending…" : "Request your invite →"}
        </button>
      </form>
      {status === "error" && <p className="site-invite-error">Something went wrong. Please try again.</p>}
    </>
  );
}
