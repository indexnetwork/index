import { useState, type FormEvent } from "react";
import { apiUrl } from "@/lib/api";

type Status = "idle" | "loading" | "success" | "error";

/**
 * Email field and "Subscribe" button joined into one control.
 * Joins the newsletter (POST /api/subscribe, type "newsletter").
 */
export default function NewsletterForm() {
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
        body: JSON.stringify({ email, type: "newsletter" }),
      });
      setStatus(res.ok ? "success" : "error");
    } catch {
      setStatus("error");
    }
  };

  if (status === "success") {
    return <p className="site-newsletter-done">You&rsquo;re in, we&rsquo;ll keep you posted on what&rsquo;s new.</p>;
  }

  return (
    <>
      <form className="site-newsletter" onSubmit={submit} noValidate>
        <input
          type="email"
          className="site-newsletter-input"
          placeholder="Enter your email"
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
          {status === "loading" ? "Sending…" : "Subscribe"}
        </button>
      </form>
      {status === "error" && <p className="site-newsletter-error">Something went wrong. Please try again.</p>}
    </>
  );
}
