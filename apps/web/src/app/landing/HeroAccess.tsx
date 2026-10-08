import { Link } from "react-router";
import { MAC_APP_DOWNLOAD_URL } from "@/app/site/links";
import NewsletterForm from "@/app/site/NewsletterForm";

/** Hero call to action: where Index runs. */
export default function HeroAccess() {
  return (
    <div className="home-access">
      <div className="home-available">
        <span className="home-available-label">AVAILABLE ON</span>
        <a className="home-available-app" href={MAC_APP_DOWNLOAD_URL}>
          <img src="/site/index-mark.svg" alt="" aria-hidden="true" />
          Mac app
        </a>
        <Link className="home-available-app" to="/hermes">
          <img src="/site/nous-research.png" alt="" aria-hidden="true" />
          Hermes plugin
        </Link>
        <Link className="home-available-app" to="/login">
          <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.2" aria-hidden="true">
            <circle cx="7" cy="7" r="5.9" />
            <ellipse cx="7" cy="7" rx="2.5" ry="5.9" />
            <path d="M1.1 7h11.8" />
          </svg>
          Web
        </Link>
      </div>

      <NewsletterForm />
    </div>
  );
}
