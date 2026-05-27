import { useState, type FormEvent } from "react";
import { Link } from "react-router";
import { apiUrl } from "@/lib/api";

type Status = "idle" | "loading" | "success" | "error";

export default function Footer() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<Status>("idle");

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!email || status === "loading") return;
    setStatus("loading");
    try {
      const res = await fetch(apiUrl("/api/subscribe"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, type: "newsletter" }),
      });
      if (res.ok) {
        setStatus("success");
        setEmail("");
      } else {
        setStatus("error");
      }
    } catch {
      setStatus("error");
    }
  };

  return (
    <footer className="lv5-footer" aria-label="footer">
      <div className="lv5-footer-inner">
        <div className="lv5-footer-left">
          <nav className="lv5-footer-nav" aria-label="footer nav">
            <Link to="/">Home</Link>
            <Link to="/blog">Blog</Link>
            <Link to="/about">About</Link>
            <Link to="/pages/privacy-policy">Privacy</Link>
            <Link to="/pages/terms-of-use">Terms</Link>
          </nav>
          <p className="lv5-footer-copy">
            © Index Network Inc. {new Date().getFullYear()}
          </p>
        </div>

        <div className="lv5-footer-right">
          <form
            id="subscribe"
            className="lv5-footer-form"
            onSubmit={handleSubmit}
            noValidate
          >
            <input
              type="email"
              className="lv5-footer-input"
              placeholder={
                status === "success" ? "subscribed ✓" : "Enter your email"
              }
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                if (status !== "idle") setStatus("idle");
              }}
              aria-label="email address"
              disabled={status === "loading"}
              required
            />
            <button
              type="submit"
              className="lv5-footer-subscribe"
              disabled={status === "loading"}
            >
              {status === "loading" ? "…" : "Subscribe"}
            </button>
          </form>

          <div className="lv5-footer-social" aria-label="social links">
            <a
              href="https://x.com/indexnetwork_"
              target="_blank"
              rel="noreferrer"
              aria-label="X / Twitter"
            >
              <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
                <path
                  fill="currentColor"
                  d="M18.244 2H21l-6.52 7.45L22 22h-6.797l-4.793-6.27L4.8 22H2l7.04-8.04L2 2h6.953l4.333 5.733L18.244 2Zm-1.19 18h1.65L7.04 4H5.27l11.784 16Z"
                />
              </svg>
            </a>
            <a
              href="https://linkedin.com/company/indexnetwork"
              target="_blank"
              rel="noreferrer"
              aria-label="LinkedIn"
            >
              <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
                <path
                  fill="currentColor"
                  d="M20.45 20.45h-3.55v-5.57c0-1.33-.03-3.04-1.85-3.04-1.85 0-2.14 1.45-2.14 2.95v5.66H9.36V9h3.41v1.56h.05c.47-.9 1.63-1.85 3.36-1.85 3.6 0 4.27 2.37 4.27 5.45v6.29ZM5.34 7.43A2.06 2.06 0 1 1 5.34 3.3a2.06 2.06 0 0 1 0 4.13ZM7.12 20.45H3.56V9h3.56v11.45ZM22.22 0H1.77C.79 0 0 .77 0 1.72v20.56C0 23.23.79 24 1.77 24h20.45c.98 0 1.78-.77 1.78-1.72V1.72C24 .77 23.2 0 22.22 0Z"
                />
              </svg>
            </a>
            <a
              href="https://github.com/indexnetwork/index"
              target="_blank"
              rel="noreferrer"
              aria-label="GitHub"
            >
              <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
                <path
                  fillRule="evenodd"
                  clipRule="evenodd"
                  fill="currentColor"
                  d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8z"
                />
              </svg>
            </a>
            <a href="mailto:hello@index.network" aria-label="Email">
              <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
                <path
                  fill="currentColor"
                  d="M3 5h18a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Zm9 8.18 8.4-5.6V7H3.6v.58l8.4 5.6Zm0 1.96L3.6 9.55V18h16.8V9.55l-8.4 5.59Z"
                />
              </svg>
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
}
