/**
 * Single source of truth for the macOS app artifact.
 *
 * Set `VITE_MAC_APP_DOWNLOAD_URL` at build time once a Developer ID-signed,
 * notarized build is published (IND-616); until then it is intentionally unset
 * and the page renders an honest "not yet available" state instead of a button
 * that 404s. Nothing else in the app needs to change when the artifact lands.
 */
export const MAC_APP_DOWNLOAD_URL: string =
  import.meta.env.VITE_MAC_APP_DOWNLOAD_URL || "";

/**
 * Minimum macOS version the bundle declares (`LSMinimumSystemVersion` in
 * apps/mac/IndexApp/Info.plist). Kept next to the download so the two are
 * updated together.
 */
export const MAC_APP_MIN_OS = "macOS 11 or later";

/**
 * `/download` — the macOS app's install page.
 *
 * It is the destination of the deep-link landing CTA (`/c/:code`, `/o/:id`),
 * so it must never be a dead end: without a published artifact it explains the
 * state rather than linking to nothing.
 */
export default function Download() {
  const available = MAC_APP_DOWNLOAD_URL.length > 0;

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
          Index for macOS
        </h1>

        <p className="text-gray-600 mb-8">
          Opportunity links open directly in the Index app, where you can review
          and accept them.
        </p>

        {available ? (
          <>
            <a
              href={MAC_APP_DOWNLOAD_URL}
              className="inline-block px-6 py-3 bg-[#041729] text-white rounded hover:bg-[#0a2d4a] transition-colors mb-3"
            >
              Download for macOS
            </a>
            <p className="text-sm text-gray-500 mb-8">{MAC_APP_MIN_OS}</p>
          </>
        ) : (
          <div className="rounded border border-gray-200 bg-white/60 px-5 py-4 mb-8">
            <p className="text-gray-700">
              Not yet publicly available. The macOS app is in private testing.
            </p>
          </div>
        )}

        {/* Plain anchor: this page is reached from the deep-link fallback by
            visitors with no app and no session, so it stays router-free. */}
        <a
          href="/"
          className="inline-block text-sm text-gray-500 hover:text-gray-900 transition-colors"
        >
          Back to Index
        </a>
      </div>
    </div>
  );
}

export const Component = Download;
