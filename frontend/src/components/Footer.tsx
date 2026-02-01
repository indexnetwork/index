'use client';

import { useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';

export default function Footer() {
  const [email, setEmail] = useState("");
  const [subscribeStatus, setSubscribeStatus] = useState<"idle" | "loading" | "success" | "error">("idle");

  const handleSubscribe = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) return;

    setSubscribeStatus("loading");
    try {
      const res = await fetch("/api/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      if (res.ok) {
        setSubscribeStatus("success");
        setEmail("");
      } else {
        setSubscribeStatus("error");
      }
    } catch {
      setSubscribeStatus("error");
    }
  };

  return (
    <footer
      className="text-white py-8 px-6 lg:px-12 border-t-4 border-foreground relative overflow-hidden w-full bg-foreground dark:bg-card dark:border-border"
    >
      <div className="max-w-[1200px] mx-auto">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          {/* Left Column: Logo + Links */}
          <div>
            <div className="mb-6">
              <Link href="/" aria-label="Index Network Home">
                <Image
                  src="/logos/logo-black-full.svg"
                  alt="Index Network"
                  width={200}
                  height={36}
                  className="brightness-0 invert object-contain"
                />
              </Link>
            </div>
            <nav aria-label="Footer navigation">
              <ul className="list-none p-0 m-0 flex gap-4 items-center">
                <li>
                  <a
                    href="https://x.com/indexnetwork_"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-background/70 hover:text-background dark:text-foreground/70 dark:hover:text-foreground transition-colors"
                    aria-label="Follow us on Twitter"
                  >
                    <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
                    </svg>
                  </a>
                </li>
                <li>
                  <a
                    href="https://linkedin.com/company/indexnetwork"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-background/70 hover:text-background dark:text-foreground/70 dark:hover:text-foreground transition-colors"
                    aria-label="Follow us on LinkedIn"
                  >
                    <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
                    </svg>
                  </a>
                </li>
                <li>
                  <a
                    href="https://github.com/indexnetwork/index"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-background/70 hover:text-background dark:text-foreground/70 dark:hover:text-foreground transition-colors"
                    aria-label="View our GitHub repository"
                  >
                    <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                      <path
                        fillRule="evenodd"
                        d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"
                        clipRule="evenodd"
                      />
                    </svg>
                  </a>
                </li>
                <li>
                  <a
                    href="mailto:hello@index.network"
                    className="text-background/70 hover:text-background dark:text-foreground/70 dark:hover:text-foreground transition-colors"
                    aria-label="Send us an email"
                  >
                    <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M1.5 8.67v8.58a3 3 0 003 3h15a3 3 0 003-3V8.67l-8.928 5.493a3 3 0 01-3.144 0L1.5 8.67z" />
                      <path d="M22.5 6.908V6.75a3 3 0 00-3-3h-15a3 3 0 00-3 3v.158l9.714 5.978a1.5 1.5 0 001.572 0L22.5 6.908z" />
                    </svg>
                  </a>
                </li>
              </ul>
            </nav>
          </div>

          {/* Right Column: Newsletter */}
          <div className="md:text-right">
              <p className="text-[14px] text-background/70 dark:text-foreground/70 mb-2 leading-relaxed font-hanken">Join our corner of the internet</p>
              <form className="flex flex-col gap-2 items-start md:items-end" aria-label="Newsletter subscription" onSubmit={handleSubscribe}>
                <label htmlFor="footer-newsletter-email" className="sr-only">
                  Email address
                </label>
                <input
                  type="email"
                  id="footer-newsletter-email"
                  name="email"
                  placeholder="Enter your email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="bg-transparent border border-background/30 dark:border-border text-background dark:text-foreground px-4 py-2.5 text-[14px] focus:outline-none focus:border-background dark:focus:border-foreground transition-colors placeholder:text-background/50 dark:placeholder:text-foreground/50 w-full md:w-64 rounded-sm font-hanken"
                  required
                  aria-required="true"
                  disabled={subscribeStatus === "loading"}
                />
                <button
                  type="submit"
                  disabled={subscribeStatus === "loading"}
                  className="bg-background dark:bg-foreground text-foreground dark:text-background hover:opacity-90 uppercase tracking-wider text-xs px-4 py-2.5 w-full md:w-64 rounded-sm transition-colors font-hanken border-none disabled:opacity-50"
                >
                  {subscribeStatus === "loading" ? "Subscribing..." : subscribeStatus === "success" ? "Subscribed!" : "Subscribe"}
                </button>
                {subscribeStatus === "error" && (
                  <p className="text-red-400 text-[12px]">Something went wrong. Try again.</p>
                )}
              </form>
            </div>
        </div>
        <div className="mt-8">
          <p className="text-[13px] text-background/60 dark:text-foreground/60">© Index Network Inc. 2026</p>
        </div>
      </div>
    </footer>
  );
}
