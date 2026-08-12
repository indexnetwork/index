import { useEffect } from "react";
import Nav, { GithubStar, ensureLandingFonts } from "@/app/landing/Nav";
import { WaitlistForm } from "@/app/landing/WaitlistForm";
import "@/app/landing/landing.css";

function WaitlistPage() {
  useEffect(() => {
    ensureLandingFonts();
  }, []);

  return (
    <div className="landing" style={{ minHeight: "100vh" }}>
      <div className="hero h1 page-hero">
        <div className="canvas-area">
          <Nav />
          <div className="hero-split">
            <div className="well">
              <h1 className="display">Request access</h1>
              <p className="body-italic">
                Index is opening in cycles. Get early access, find your networks,
                or start your own.
              </p>
              <div style={{ marginTop: 32, maxWidth: 440 }}>
                <WaitlistForm idPrefix="waitlist-page" />
              </div>
              <div
                className="waitlist-actions"
                aria-label="social links"
                style={{ marginTop: 24 }}
              >
                <GithubStar />
                <a
                  className="gh-star"
                  href="https://x.com/indexnetwork_"
                  target="_blank"
                  rel="noreferrer"
                  aria-label="Follow Index Network on X"
                >
                  <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
                    <path
                      fill="currentColor"
                      d="M18.244 2H21l-6.52 7.45L22 22h-6.797l-4.793-6.27L4.8 22H2l7.04-8.04L2 2h6.953l4.333 5.733L18.244 2Zm-1.19 18h1.65L7.04 4H5.27l11.784 16Z"
                    />
                  </svg>
                  Follow on X
                </a>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default WaitlistPage;
export const Component = WaitlistPage;
