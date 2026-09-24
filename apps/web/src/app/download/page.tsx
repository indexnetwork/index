import "./download.css";

const MAC_TAG = import.meta.env.VITE_PROTOCOL_URL?.includes("dev.") ? "mac-dev" : "mac";
const MAC_APP_DOWNLOAD_URL = `https://github.com/indexnetwork/mac-client/releases/download/${MAC_TAG}/Index.dmg`;
const HERMES_INSTALL_URL =
  "hermes://plugin/install?repo=indexnetwork/hermes-plugin&enable=1";

/** Shown on the Index for Mac card. */
export const MAC_APP_REQUIREMENTS = "macOS 13+ · Apple silicon";

/**
 * `/download` — post-invite install page. Centered hero, the two install
 * cards, and a browser link. No app chrome.
 */
export default function Download() {
  return (
    <div className="download-page">
      <main className="download-page__main">
        <p className="download-page__step">5</p>
        <p className="download-page__kicker">You&apos;re in</p>
        <h1 className="download-page__title">get the apps</h1>
        <p className="download-page__lede">
          Install Index on macOS or add the Hermes plugin to stay connected to
          your networks.
        </p>

        <div className="download-page__offers">
          <div className="download-page__cards">
            <section className="download-card">
              <div className="download-card__body">
                <span className="download-card__icon">
                  <IndexMark />
                </span>
                <h2 className="download-card__name">Index for Mac</h2>
                <p className="download-card__meta">{MAC_APP_REQUIREMENTS}</p>

                <a
                  className="download-btn download-btn--primary"
                  href={MAC_APP_DOWNLOAD_URL}
                  aria-label="Download Index for Mac"
                >
                  INSTALL →
                </a>
              </div>
            </section>

            <section className="download-card">
              <div className="download-card__body">
                <span className="download-card__icon download-card__icon--outlined">
                  <img src="/logos/nous.webp" alt="" aria-hidden="true" />
                </span>
                <h2 className="download-card__name">Hermes plugin</h2>
                <p className="download-card__meta">one-line plugin install</p>

                <a
                  className="download-btn download-btn--ghost"
                  href={HERMES_INSTALL_URL}
                  aria-label="Install Hermes plugin"
                >
                  INSTALL
                </a>
              </div>
            </section>
          </div>

          <a className="download-page__browser" href="/">
            Open Index in the browser →
          </a>
        </div>
      </main>
    </div>
  );
}

/** The Index mark, inverted for the card: white tile, background-coloured glyph. */
function IndexMark() {
  return (
    <svg viewBox="0 0 64 64" aria-hidden="true" xmlns="http://www.w3.org/2000/svg">
      <rect width="64" height="64" fill="#fff" />
      <path
        d="M36.5778 18.7058V45.2984H27.7592V18.7058H36.5778L27.8611 10H19V36.5502L36.4716 54H45.3327V27.4498L36.5778 18.7058Z"
        fill="#0d1a13"
      />
    </svg>
  );
}

export const Component = Download;
