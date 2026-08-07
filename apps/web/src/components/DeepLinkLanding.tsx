import { useState } from "react";

import CopyableBox from "@/components/CopyableBox";

// The install page owns the artifact URL (and its "not yet published" state),
// so this CTA always points at a real route rather than at a build that may
// not exist yet. A plain anchor keeps this fallback page free of router
// context — it is rendered for visitors with no app and no session.
export const DOWNLOAD_PATH = "/download";

/**
 * Presentation-only platform sniff. iPadOS reports a Macintosh UA, so require
 * no touch points to avoid showing a macOS download CTA on iPads.
 */
function isMacOS(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  return /macintosh|mac os x/i.test(ua) && (navigator.maxTouchPoints ?? 0) === 0;
}

/**
 * Universal-link fallback for deep links (`/c/:code`, `/o/:id`).
 *
 * When the macOS app is installed the OS intercepts these URLs before this
 * page ever renders, so every viewer definitionally lacks the app. The page
 * is the whole fallback: no auth, no API calls, no login continuation.
 */
export default function DeepLinkLanding() {
  const [url] = useState(() => window.location.href);
  const [mac] = useState(isMacOS);

  return (
    <div className="relative min-h-screen flex items-center justify-center">
      <div
        className="fixed inset-0 pointer-events-none -z-10"
        style={{
          background: "url(/noise.jpg)",
          opacity: 0.12,
        }}
      />

      <div className="text-center max-w-md px-6">
        <h1 className="text-3xl font-bold text-gray-900 mb-4">
          Open in the Index app
        </h1>

        {mac ? (
          <>
            <p className="text-gray-600 mb-8">
              This link opens in the Index macOS app.
            </p>
            <a
              href={DOWNLOAD_PATH}
              className="inline-block px-6 py-3 bg-[#041729] text-white rounded hover:bg-[#0a2d4a] transition-colors mb-3"
            >
              Get the Index app
            </a>
            <p className="text-sm text-gray-500 mb-8">
              Already installed? Re-click your link — it will open in the app.
            </p>
          </>
        ) : (
          <p className="text-gray-600 mb-8">
            Index connect links open in the macOS app. Open this link on your
            Mac.
          </p>
        )}

        <CopyableBox value={url} />
      </div>
    </div>
  );
}
