/**
 * Card for the macOS app, used on `/use/mac`.
 *
 * Access is invite-only, so the card sends people to the request-access page
 * on the landing site. The release link points at the stable rolling release
 * that `.github/workflows/mac-app-release.yml` publishes from `main` to the
 * public `indexnetwork/mac-client` mirror.
 * Styles live in `src/pages/_root.css` under "Mac download".
 */

const RELEASE_TAG = 'mac'
const REQUEST_ACCESS_URL = 'https://index.network/waitlist'
const RELEASE_URL = `https://github.com/indexnetwork/mac-client/releases/tag/${RELEASE_TAG}`

/** Mirrors `LSMinimumSystemVersion` and the arm64-only build in apps/mac. */
const REQUIREMENTS = ['macOS 13 or later', 'Apple silicon', 'Notarized by Apple']

export function MacDownload() {
  return (
    <div className="mac-download">
      <img
        className="mac-download__icon"
        src="/images/index-macos-icon.png"
        alt=""
        width={72}
        height={72}
      />
      <div className="mac-download__body">
        <p className="mac-download__name">Index for macOS</p>
        <ul className="mac-download__meta">
          {REQUIREMENTS.map((requirement) => (
            <li key={requirement}>{requirement}</li>
          ))}
        </ul>
      </div>
      <div className="mac-download__actions">
        <a className="mac-download__button" href={REQUEST_ACCESS_URL}>
          <span>Request your invite</span>
        </a>
        <a className="mac-download__releases" href={RELEASE_URL}>
          View release on GitHub →
        </a>
      </div>
    </div>
  )
}
