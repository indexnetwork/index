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
 * Hermes Desktop / plugin install destination. Defaults to the public Hermes
 * agent site; override with `VITE_HERMES_INSTALL_URL` for staging or docs links.
 */
export const HERMES_INSTALL_URL: string =
  import.meta.env.VITE_HERMES_INSTALL_URL || "https://hermes-agent.nousresearch.com/";

/** Shown on the Index for Mac card. */
export const MAC_APP_REQUIREMENTS = "macOS 13+ · Apple silicon";

/**
 * `/download` — post-invite install page. Centered body only (no app chrome),
 * matching the card layout from the download landing mockup.
 */
export default function Download() {
  const indexAvailable = MAC_APP_DOWNLOAD_URL.length > 0;

  return (
    <div className="download-page">
      <div className="download-page__inner">
        <div className="download-page__intro">
          <p className="download-page__kicker">You&apos;re in</p>
          <h1 className="download-page__title">Get the apps</h1>
          <p className="download-page__lede">
            Install Index on macOS or add the Hermes plugin to stay connected to
            your networks.
          </p>
        </div>

        <div className="download-page__cards">
          {indexAvailable ? (
            <a
              className="download-card"
              href={MAC_APP_DOWNLOAD_URL}
              aria-label="Download Index for Mac"
            >
              <IndexCardBody actionLabel="Download" actionVariant="primary" />
            </a>
          ) : (
            <div className="download-card download-card--static" aria-label="Index for Mac">
              <IndexCardBody actionLabel="Coming soon" actionVariant="disabled" />
            </div>
          )}

          <a
            className="download-card"
            href={HERMES_INSTALL_URL}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Install Hermes plugin"
          >
            <span className="download-card__icon">
              <img src="/logos/nous.webp" alt="" aria-hidden="true" />
            </span>
            <span className="download-card__copy">
              <span className="download-card__name">Hermes plugin</span>
              <span className="download-card__meta">one-line plugin install</span>
            </span>
            <span className="download-card__action download-card__action--ghost">
              Install
            </span>
          </a>
        </div>
      </div>
    </div>
  );
}

function IndexCardBody({
  actionLabel,
  actionVariant,
}: {
  actionLabel: string;
  actionVariant: "primary" | "disabled";
}) {
  return (
    <>
      <span className="download-card__icon">
        <AppleMark />
      </span>
      <span className="download-card__copy">
        <span className="download-card__name">Index for Mac</span>
        <span className="download-card__meta">{MAC_APP_REQUIREMENTS}</span>
      </span>
      <span className={`download-card__action download-card__action--${actionVariant}`}>
        {actionLabel}
      </span>
    </>
  );
}

function AppleMark() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="currentColor"
        d="M17.05 12.94c-.03-2.7 2.2-4 2.3-4.06-1.25-1.83-3.2-2.08-3.9-2.11-1.66-.17-3.24.98-4.08.98-.84 0-2.14-.96-3.52-.93-1.81.03-3.48 1.05-4.41 2.67-1.88 3.27-.48 8.1 1.35 10.75.9 1.3 1.97 2.75 3.38 2.7 1.36-.06 1.87-.88 3.51-.88 1.64 0 2.1.88 3.53.85 1.46-.02 2.38-1.32 3.27-2.62 1.03-1.5 1.46-2.96 1.48-3.03-.03-.01-2.85-1.09-2.88-4.32M14.4 4.9c.74-.9 1.24-2.15 1.1-3.4-1.07.05-2.36.72-3.13 1.61-.69.8-1.29 2.07-1.13 3.29 1.19.09 2.41-.6 3.16-1.5"
      />
    </svg>
  );
}

export const Component = Download;
