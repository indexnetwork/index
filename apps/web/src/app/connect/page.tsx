import { useEffect } from "react";
import { SiteSignInPage } from "@/components/SiteSignIn";
import { joinLink, outLinks } from "./links";
import "./page.css";

/**
 * Public handout: deliberately outside the authenticated app shell, but in
 * the same look as every other page outside the app (sign-in, invites).
 */
export function Component() {
  useEffect(() => {
    const previousTitle = document.title;
    document.title = "Connect with Index";
    return () => { document.title = previousTitle; };
  }, []);

  return (
    <SiteSignInPage
      bar="connect"
      kicker="index network"
      title="find your people"
      meta={<p className="site-p">try it for yourself, and keep the conversation going.</p>}
    >
      <div className="signin-status connect-actions">
        <a className="site-btn site-btn--block" href={joinLink.href}>{joinLink.label}</a>
        <nav className="connect-out" aria-label="more from index">
          {outLinks.map(({ label, href }) => (
            <a key={label} href={href} target="_blank" rel="noopener noreferrer">{label}</a>
          ))}
        </nav>
      </div>
    </SiteSignInPage>
  );
}
