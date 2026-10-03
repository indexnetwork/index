import InviteForm from "@/app/site/InviteForm";

/** Hero call to action: where Index runs, then the invite request. */
export default function HeroAccess() {
  return (
    <div className="home-access">
      <div className="home-available">
        <span className="home-available-label">AVAILABLE ON</span>
        <span className="home-available-app">
          <img src="/site/index-mark.svg" alt="" aria-hidden="true" />
          macOS
        </span>
        <span className="home-available-app">
          <img src="/site/nous-research.png" alt="" aria-hidden="true" />
          Hermes Agent
        </span>
      </div>

      <p>The early network is invitation only - we&rsquo;ll open up public access soon.</p>

      <InviteForm />
    </div>
  );
}
