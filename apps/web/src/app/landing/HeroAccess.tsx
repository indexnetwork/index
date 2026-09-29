import { useState, type FormEvent } from "react";
import { Link } from "react-router";
import { apiUrl } from "@/lib/api";

type Status = "idle" | "loading" | "success" | "error";

/**
 * Hero call to action: where Index runs, then an invitation request
 * (POST /api/subscribe, type "waitlist").
 */
export default function HeroAccess() {
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

  return (
    <div className="home-access">
      <p>The early network is invitation only.</p>

      <div className="home-available">
        <span className="home-available-label">AVAILABLE ON</span>
        <Link className="home-available-app" to="/download">
          <img src="/site/index-logo.png" alt="" aria-hidden="true" />
          macOS
        </Link>
        <Link className="home-available-app" to="/hermes">
          <img src="/site/hermes-logo.png" alt="" aria-hidden="true" />
          Hermes Agent
        </Link>
      </div>

      {status === "success" ? (
        <p className="home-invite-done">You&rsquo;re on the list. We&rsquo;ll be in touch.</p>
      ) : (
        <form className="home-invite" onSubmit={submit} noValidate>
          <input
            type="email"
            className="home-invite-input"
            placeholder="you@domain.com"
            aria-label="Email address"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              if (status === "error") setStatus("idle");
            }}
            disabled={status === "loading"}
            required
          />
          <button type="submit" className="site-btn" disabled={status === "loading"}>
            {status === "loading" ? "Sending…" : "Request invitation"}
          </button>
        </form>
      )}
      {status === "error" && (
        <p className="home-invite-error">Something went wrong. Please try again.</p>
      )}
    </div>
  );
}
