import { useEffect, useState } from "react";
import { loadMacReleaseMetadata, macReleaseCmsUrl, type MacReleaseMetadata } from "@/lib/mac-release";
import "./download.css";

/** Immutable signed release JSON. The page fails closed when absent/invalid. */
export const MAC_RELEASE_METADATA_URL: string =
  import.meta.env.VITE_MAC_RELEASE_METADATA_URL || "";

/**
 * Hermes Desktop / plugin install destination. Defaults to the public Hermes
 * agent site; override with `VITE_HERMES_INSTALL_URL` for staging or docs links.
 */
export const HERMES_INSTALL_URL: string =
  import.meta.env.VITE_HERMES_INSTALL_URL || "https://hermes-agent.nousresearch.com/";

/** Shown on the Index for Mac card. */
export const MAC_APP_REQUIREMENTS = "macOS 13+ · Universal 2";

function artifactSize(size: number): string {
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * `/download` — post-invite install page. Full-viewport column: header,
 * centered hero and cards. No app chrome.
 */
export default function Download({
  metadataUrl = MAC_RELEASE_METADATA_URL,
  release: suppliedRelease,
}: {
  metadataUrl?: string;
  release?: MacReleaseMetadata | null;
}) {
  const [release, setRelease] = useState<MacReleaseMetadata | null>(suppliedRelease ?? null);
  const [settled, setSettled] = useState(suppliedRelease !== undefined);

  useEffect(() => {
    if (suppliedRelease !== undefined) return;
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      setRelease(null);
      setSettled(!metadataUrl);
    });
    if (!metadataUrl) return () => { active = false; };
    loadMacReleaseMetadata(metadataUrl)
      .then((value) => { if (active) setRelease(value); })
      .catch(() => { if (active) setRelease(null); })
      .finally(() => { if (active) setSettled(true); });
    return () => { active = false; };
  }, [metadataUrl, suppliedRelease]);

  const app = release?.artifacts.find((artifact) => artifact.kind === "app-dmg");
  const connector = release?.artifacts.find((artifact) => artifact.kind === "connector-dmg");
  const releaseAvailable = settled && release && app && connector;

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

              {releaseAvailable ? (
                <>
                  <a
                    className="download-btn download-btn--primary"
                    href={app.url}
                    aria-label="Download Index for Mac"
                  >
                    INSTALL →
                  </a>
                  <p className="download-card__note">
                    v{release.releaseVersion} · {artifactSize(app.size)}
                  </p>
                  <code className="download-card__checksum">{app.sha256}</code>
                </>
              ) : (
                <>
                  <span className="download-btn download-btn--disabled" aria-disabled="true">
                    DOWNLOAD UNAVAILABLE
                  </span>
                  <p className="download-card__note">Verified release metadata is unavailable.</p>
                </>
              )}
            </div>
          </section>

          <section className="download-card">
            <div className="download-card__body">
              <span className="download-card__icon download-card__icon--outlined">
                <img src="/logos/nous.webp" alt="" aria-hidden="true" />
              </span>
              <h2 className="download-card__name">Index Connector</h2>
              <p className="download-card__meta">Standalone Hermes connector</p>

              {releaseAvailable ? (
                <>
                  <a
                    className="download-btn download-btn--ghost"
                    href={connector.url}
                    aria-label="Download Index Connector"
                  >
                    INSTALL
                  </a>
                  <p className="download-card__note">{artifactSize(connector.size)}</p>
                  <code className="download-card__checksum">{connector.sha256}</code>
                  <a className="download-card__metadata" href={metadataUrl}>Release metadata</a>
                  <a className="download-card__metadata" href={macReleaseCmsUrl(metadataUrl)}>CMS signature</a>
                </>
              ) : (
                <a
                  className="download-btn download-btn--ghost"
                  href={HERMES_INSTALL_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label="Install Hermes plugin"
                >
                  HERMES INFO
                </a>
              )}
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
