import { useState } from 'react';
import { Link } from 'react-router';
import { apiUrl } from '@/lib/api';

export default function Footer() {
  const [email, setEmail] = useState("");
  const [subscribeStatus, setSubscribeStatus] = useState<"idle" | "loading" | "success" | "error">("idle");

  const handleSubscribe = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) return;

    setSubscribeStatus("loading");
    try {
      const res = await fetch(apiUrl("/api/subscribe"), {
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
    <footer className="py-4 px-6 lg:px-12 w-full bg-[#F4F7F6]">
      <div className="max-w-[1200px] mx-auto flex flex-col gap-3">
        {/* Top row: page links left, newsletter + social right */}
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
          <nav aria-label="Footer navigation" className="flex flex-wrap gap-x-5 gap-y-2 text-[13px] text-[#041729]">
            <Link to="/" className="hover:text-black transition-colors">Home</Link>
            <Link to="/blog" className="hover:text-black transition-colors">Blog</Link>
            <Link to="/about" className="hover:text-black transition-colors">About</Link>
            <Link to="/pages/privacy-policy" className="hover:text-black transition-colors">Privacy</Link>
            <Link to="/pages/terms-of-use" className="hover:text-black transition-colors">Terms</Link>
          </nav>

          <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4">
            {/* Newsletter inline */}
            <form className="flex items-center gap-2" aria-label="Newsletter subscription" onSubmit={handleSubscribe}>
              <label htmlFor="footer-newsletter-email" className="sr-only">Email address</label>
              <input
                type="email"
                id="footer-newsletter-email"
                name="email"
                placeholder="Enter your email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="bg-white border border-gray-300 text-black px-3 py-[7px] text-xs focus:outline-none focus:border-black transition-colors placeholder:text-gray-400 w-full sm:w-48 rounded-sm font-sans"
                required
                aria-required="true"
                disabled={subscribeStatus === "loading"}
              />
              <button
                type="submit"
                disabled={subscribeStatus === "loading"}
                className="bg-[#041729] text-white hover:bg-[#0a2d4a] uppercase tracking-wider text-xs px-3 py-[7px] rounded-[2px] transition-colors font-sans font-semibold border-none disabled:opacity-50 shrink-0"
              >
                {subscribeStatus === "loading" ? "..." : subscribeStatus === "success" ? "Done!" : "Subscribe"}
              </button>
              {subscribeStatus === "error" && (
                <span className="text-red-500 text-[11px]">Failed</span>
              )}
            </form>

            {/* Social icons */}
            <div className="flex gap-3 items-center">
              <a href="https://x.com/indexnetwork_" target="_blank" rel="noopener noreferrer" className="text-[#041729] hover:text-black transition-colors" aria-label="Twitter">
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
                </svg>
              </a>
              <a href="https://linkedin.com/company/indexnetwork" target="_blank" rel="noopener noreferrer" className="text-[#041729] hover:text-black transition-colors" aria-label="LinkedIn">
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
                </svg>
              </a>
              <a href="https://github.com/indexnetwork/index" target="_blank" rel="noopener noreferrer" className="text-[#041729] hover:text-black transition-colors" aria-label="GitHub">
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path fillRule="evenodd" d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" clipRule="evenodd" />
                </svg>
              </a>
              <a href="mailto:hello@index.network" className="text-[#041729] hover:text-black transition-colors" aria-label="Email">
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M1.5 8.67v8.58a3 3 0 003 3h15a3 3 0 003-3V8.67l-8.928 5.493a3 3 0 01-3.144 0L1.5 8.67z" />
                  <path d="M22.5 6.908V6.75a3 3 0 00-3-3h-15a3 3 0 00-3 3v.158l9.714 5.978a1.5 1.5 0 001.572 0L22.5 6.908z" />
                </svg>
              </a>
            </div>
          </div>
        </div>

        {/* Bottom row: copyright */}
        <div className="text-[12px] text-gray-400">
          <p>&copy; Index Network Inc. 2026</p>
        </div>
      </div>
    </footer>
  );
}
