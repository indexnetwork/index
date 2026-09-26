'use client'

/**
 * Install card for the Hermes plugin, used on `/use/hermes`.
 *
 * Shares the `mac-download` card styles in `src/pages/_root.css`; the command
 * row is under "Hermes install".
 */

import { useState } from 'react'

const INSTALL_URL = 'hermes://plugin/install?repo=indexnetwork/hermes-plugin&enable=1'
const REPO_URL = 'https://github.com/indexnetwork/hermes-plugin'
const COMMAND = 'hermes plugins install indexnetwork/hermes-plugin'

export function HermesInstall() {
  const [copied, setCopied] = useState(false)

  function copy() {
    navigator.clipboard.writeText(COMMAND)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

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
        <p className="mac-download__name">Index plugin for Hermes</p>
        <ul className="mac-download__meta">
          <li>Open on the machine that runs Hermes</li>
          <li>Installs and enables</li>
        </ul>
      </div>
      <div className="mac-download__actions">
        <a className="mac-download__button" href={INSTALL_URL}>
          <span>Install in Hermes</span>
        </a>
        <a className="mac-download__releases" href={REPO_URL}>
          View plugin on GitHub →
        </a>
      </div>
      <button type="button" className="hermes-install__command" onClick={copy}>
        <span className="hermes-install__prompt">$</span>
        <code>{COMMAND}</code>
        <span className="hermes-install__copy">{copied ? 'Copied' : 'Copy'}</span>
      </button>
    </div>
  )
}
