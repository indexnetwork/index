import { Link } from "react-router";
import CopyPromptButton from "@/app/site/CopyPromptButton";

function CopyIcon() {
  return (
    <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.1" aria-hidden="true">
      <rect x="4.5" y="4.5" width="8" height="8" rx="1.2" />
      <path d="M9.5 4.5V2.7a1.2 1.2 0 0 0-1.2-1.2H2.7a1.2 1.2 0 0 0-1.2 1.2v5.6a1.2 1.2 0 0 0 1.2 1.2h1.8" />
    </svg>
  );
}

/** Hero call to action: open the app, or bring Index to the agent you already use. */
export default function HeroAccess() {
  return (
    <div className="home-access">
      <div className="home-platforms">
        <Link className="home-platform" to="/login">
          Open app
          <span className="home-platform-arrow" aria-hidden="true">{"→"}</span>
        </Link>
        <Link className="home-platform home-platform--secondary" to="/hermes">
          <img className="home-platform-logo" src="/site/nous-research.png" alt="" />
          Hermes Agent
        </Link>
        <CopyPromptButton className="home-platform home-platform--secondary" icon={<CopyIcon />} label="Copy prompt for your agent" />
      </div>
    </div>
  );
}
