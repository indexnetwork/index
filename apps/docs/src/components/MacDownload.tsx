'use client'

/**
 * Card for the macOS app, used on `/use/mac`.
 *
 * Access is invite-only, so the main button opens the invite dialog. The
 * release link points at the stable rolling release
 * that `.github/workflows/mac-app-release.yml` publishes from `main` to the
 * public `indexnetwork/mac-client` mirror.
 * Styles live in `src/pages/_root.css` under "Mac download".
 */

import { InviteButton } from './InviteButton'

const RELEASE_TAG = 'mac'
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
        <InviteButton className="mac-download__button" />
        <a className="mac-download__releases" href={RELEASE_URL}>
          View release on GitHub →
        </a>
      </div>
    </div>
  )
}
