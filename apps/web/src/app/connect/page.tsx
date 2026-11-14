import { useEffect } from "react";
import { CalendarDays, LogIn, Presentation } from "lucide-react";
import { ensureSiteFonts } from "@/app/site/SiteLayout";
import { connectLinks } from "./links";
import "./page.css";

const actionIcons = [LogIn, Presentation, CalendarDays];

/** Public handout: deliberately outside the authenticated app shell. */
export function Component() {
  useEffect(() => {
    ensureSiteFonts();
    const previousTitle = document.title;
    document.title = "Connect with Index";
    return () => { document.title = previousTitle; };
  }, []);

  return (
    <div className="site connect-page">
      <main className="connect-content">
        <img className="connect-logo" src="/site/index-logo.svg" alt="Index Network" width={433} height={36} />
        <h1>Find your people.</h1>
        <p>Try it for yourself. Keep the conversation going.</p>
        <nav className="connect-links" aria-label="Connect with Index">
          {connectLinks.map(({ label, href }, index) => {
            const Icon = actionIcons[index];
            return (
              <a key={label} className="connect-link" href={href}>
                <Icon size={24} strokeWidth={2} aria-hidden="true" />
                <span>{label}</span>
              </a>
            );
          })}
        </nav>
        <span className="connect-footer">index.network</span>
      </main>
    </div>
  );
}
