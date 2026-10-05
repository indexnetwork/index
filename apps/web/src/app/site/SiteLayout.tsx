import { useEffect, useState, type ReactNode } from "react";
import { Link, useLocation } from "react-router";
import { CONTACT_EMAIL, DOCS_URL, EARLY_ACCESS_PATH, GITHUB_URL, X_URL } from "./links";
import "./site.css";

const FONT_HREF =
  "https://fonts.googleapis.com/css2?family=Source+Serif+4:ital,opsz,wght@0,8..60,400;1,8..60,400&family=Public+Sans:ital,wght@0,300;0,400;0,500;0,700;1,300;1,400&display=swap";

/** Injects the Source Serif 4 + Public Sans pair the marketing pages use. */
export function ensureSiteFonts() {
  if (typeof document === "undefined") return;
  if (document.querySelector(`link[href="${FONT_HREF}"]`)) return;

  const preconnect1 = document.createElement("link");
  preconnect1.rel = "preconnect";
  preconnect1.href = "https://fonts.googleapis.com";
  const preconnect2 = document.createElement("link");
  preconnect2.rel = "preconnect";
  preconnect2.href = "https://fonts.gstatic.com";
  preconnect2.crossOrigin = "";
  const font = document.createElement("link");
  font.rel = "stylesheet";
  font.href = FONT_HREF;
  document.head.append(preconnect1, preconnect2, font);
}

/**
 * Navbar. Below 640px the links collapse behind a menu button. `logoOnly`:
 * app steps (install, CLI sign-in, consent) keep the logo but drop the links.
 */
export function SiteNav({ logoOnly = false }: { logoOnly?: boolean } = {}) {
  const [open, setOpen] = useState(false);
  const { pathname } = useLocation();

  useEffect(() => setOpen(false), [pathname]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <nav className={open ? "site-nav site-nav--open" : "site-nav"} aria-label="primary">
      <Link className="site-nav-logo" to="/" aria-label="Index Network">
        <img src="/site/index-logo.svg" alt="Index Network" />
      </Link>
      {!logoOnly && <>
      <button
        type="button"
        className="site-nav-toggle"
        aria-expanded={open}
        aria-controls="site-nav-links"
        aria-label={open ? "Close menu" : "Open menu"}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="site-nav-toggle-bar" />
        <span className="site-nav-toggle-bar" />
      </button>
      <div className="site-nav-links" id="site-nav-links">
        <Link className="site-nav-link" to="/blog">blog</Link>
        <a className="site-nav-link" href={DOCS_URL} target="_blank" rel="noreferrer">docs</a>
        <Link className="site-nav-link" to="/about">about</Link>
        <Link className="site-btn" to={EARLY_ACCESS_PATH}>Request your invite</Link>
      </div>
      </>}
    </nav>
  );
}

export function SiteFooter({ className = "site-footer" }: { className?: string }) {
  return (
    <footer className={className} aria-label="footer">
      <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>
      <a href={GITHUB_URL} target="_blank" rel="noreferrer">GitHub</a>
      <a href={X_URL} target="_blank" rel="noreferrer">X</a>
      <Link to="/pages/privacy-policy">Privacy</Link>
      <Link to="/pages/terms-of-use">Terms</Link>
    </footer>
  );
}

/**
 * Shared shell for the public pages: one 836px column with the navbar on top
 * and the footer below. `banner` shows the Superstudio image under the footer.
 */
export default function SiteLayout({
  children,
  banner = false,
  className,
}: {
  children: ReactNode;
  banner?: boolean;
  className?: string;
}) {
  useEffect(() => {
    ensureSiteFonts();
  }, []);

  return (
    <div className={className ? `site ${className}` : "site"}>
      <div className="site-col">
        <SiteNav />
        {children}
      </div>
      <SiteFooter />
      {banner && (
        <img
          className="site-banner"
          src="/site/banner-v3.jpg"
          alt="Gridded valley meeting the mountains - after Superstudio"
        />
      )}
    </div>
  );
}
