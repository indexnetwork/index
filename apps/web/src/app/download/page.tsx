import "./download.css";

/**
 * Single source of truth for the macOS app artifact.
 *
 * Set `VITE_MAC_APP_DOWNLOAD_URL` at build time once a Developer ID-signed,
 * notarized build is published (IND-616); until then the Mac card stays visible
 * with a disabled action rather than linking at nothing.
 */
export const MAC_APP_DOWNLOAD_URL: string =
  import.meta.env.VITE_MAC_APP_DOWNLOAD_URL || "";

/**
 * Artifact size, shown under the install button beside the filename. There is
 * no way to know it from the URL without fetching the file, so it is supplied
 * at build time next to the URL above, and simply omitted when absent.
 */
export const MAC_APP_DOWNLOAD_SIZE: string =
  import.meta.env.VITE_MAC_APP_DOWNLOAD_SIZE || "";

/**
 * Hermes Desktop plugin-install deeplink. Override with
 * `VITE_HERMES_INSTALL_URL` for staging or docs links.
 */
export const HERMES_INSTALL_URL: string =
  import.meta.env.VITE_HERMES_INSTALL_URL ||
  "hermes://plugin/install?repo=indexnetwork/hermes-plugin&enable=1";

/** Shown on the Index for Mac card. */
export const MAC_APP_REQUIREMENTS = "macOS 13+ · Apple silicon";

/** `index-0.1.0.dmg · 84 mb`, from whichever halves are actually known. */
function macArtifactLine(): string {
  const filename = MAC_APP_DOWNLOAD_URL.split("?")[0].split("/").pop() || "";
  return [filename, MAC_APP_DOWNLOAD_SIZE].filter(Boolean).join(" · ");
}

/**
 * `/download` — post-invite install page. Full-viewport column: header,
 * centered hero and cards. No app chrome.
 */
export default function Download() {
  const indexAvailable = MAC_APP_DOWNLOAD_URL.length > 0;
  const artifactLine = indexAvailable ? macArtifactLine() : "";

  return (
    <div className="download-page">
      <header className="download-page__header">
        <a className="download-page__logo" href="/" aria-label="Index Network">
          <img src="/logos/logo-white-full.svg" alt="Index Network" />
        </a>
      </header>

      <main className="download-page__main">
        <p className="download-page__kicker">You&apos;re in</p>
        <h1 className="download-page__title">get the apps</h1>
        <p className="download-page__lede">
          Install Index on macOS or add the Hermes plugin to stay connected to
          your networks.
        </p>

        <div className="download-page__cards">
          <section className="download-card">
            <div className="download-card__body">
              <span className="download-card__icon">
                <IndexMark />
              </span>
              {/* The card's own name, so it carries the heading the removed
                  header bar used to. */}
              <h2 className="download-card__name">Index for Mac</h2>
              <p className="download-card__meta">{MAC_APP_REQUIREMENTS}</p>

              {/* Until a notarized build is published there is nothing to link
                  at, so the primary action holds its place disabled rather than
                  claiming a download that would 404. */}
              {indexAvailable ? (
                <a
                  className="download-btn download-btn--primary"
                  href={MAC_APP_DOWNLOAD_URL}
                  aria-label="Download Index for Mac"
                >
                  INSTALL →
                </a>
              ) : (
                <span className="download-btn download-btn--disabled" aria-disabled="true">
                  COMING SOON
                </span>
              )}

              {artifactLine ? (
                <p className="download-card__note">{artifactLine}</p>
              ) : null}
            </div>
          </section>

          <section className="download-card">
            <div className="download-card__body">
              <span className="download-card__icon download-card__icon--outlined">
                <img src="/logos/nous.webp" alt="" aria-hidden="true" />
              </span>
              <h2 className="download-card__name">Hermes plugin</h2>
              <p className="download-card__meta">one-line plugin install</p>

              {/* Both buttons read "INSTALL"; the labels say which is which for
                  anyone who cannot see the card they sit in. */}
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
