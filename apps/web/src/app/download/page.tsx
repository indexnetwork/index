/**
 * Foundational release publication contract. Task 7 replaces these build-time
 * fields with strict signed-metadata parsing; until then all fields must be
 * present or this page fails closed without artifact links.
 */
export const MAC_RELEASE_VERSION: string =
  import.meta.env.VITE_MAC_RELEASE_VERSION || "";
export const MAC_APP_DOWNLOAD_URL: string =
  import.meta.env.VITE_MAC_APP_DOWNLOAD_URL || "";
export const MAC_APP_SHA256: string = import.meta.env.VITE_MAC_APP_SHA256 || "";
export const MAC_CONNECTOR_DOWNLOAD_URL: string =
  import.meta.env.VITE_MAC_CONNECTOR_DOWNLOAD_URL || "";
export const MAC_CONNECTOR_SHA256: string =
  import.meta.env.VITE_MAC_CONNECTOR_SHA256 || "";
export const MAC_RELEASE_METADATA_URL: string =
  import.meta.env.VITE_MAC_RELEASE_METADATA_URL || "";

export const MAC_APP_MIN_OS = "macOS 13 or later";

export type MacReleaseDownload = {
  version: string;
  appUrl: string;
  appSha256: string;
  connectorUrl: string;
  connectorSha256: string;
  metadataUrl: string;
};

export const MAC_RELEASE_DOWNLOAD: MacReleaseDownload = {
  version: MAC_RELEASE_VERSION,
  appUrl: MAC_APP_DOWNLOAD_URL,
  appSha256: MAC_APP_SHA256,
  connectorUrl: MAC_CONNECTOR_DOWNLOAD_URL,
  connectorSha256: MAC_CONNECTOR_SHA256,
  metadataUrl: MAC_RELEASE_METADATA_URL,
};

function releaseAvailable(release: MacReleaseDownload) {
  return Object.values(release).every((value) => value.length > 0);
}

function Artifact({
  name,
  href,
  sha256,
}: {
  name: string;
  href: string;
  sha256: string;
}) {
  return (
    <div className="rounded border border-gray-200 bg-white/60 px-5 py-4 text-left">
      <a
        href={href}
        className="font-semibold text-[#041729] hover:text-[#0a2d4a] transition-colors"
      >
        Download {name}
      </a>
      <p className="mt-2 text-xs text-gray-500">SHA-256</p>
      <code className="block mt-1 text-xs text-gray-700 break-all">{sha256}</code>
    </div>
  );
}

/** `/download` — the macOS app and standalone connector install page. */
export default function Download({
  release = MAC_RELEASE_DOWNLOAD,
}: {
  release?: MacReleaseDownload;
}) {
  return (
    <div className="relative min-h-screen flex items-center justify-center">
      <div
        className="fixed inset-0 pointer-events-none -z-10"
        style={{ background: "url(/noise.jpg)", opacity: 0.12 }}
      />

      <div className="text-center max-w-xl px-6 py-12">
        <h1 className="text-3xl font-bold text-gray-900 mb-4">
          Index for macOS
        </h1>
        <p className="text-gray-600 mb-6">
          Opportunity links open directly in the Index app. The standalone
          connector lets Hermes connect without installing the app.
        </p>

        {releaseAvailable(release) ? (
          <>
            <p className="font-medium text-gray-800">Version {release.version}</p>
            <p className="text-sm text-gray-500 mb-6">{MAC_APP_MIN_OS}</p>
            <div className="grid gap-4 sm:grid-cols-2 mb-6">
              <Artifact
                name="Index app"
                href={release.appUrl}
                sha256={release.appSha256}
              />
              <Artifact
                name="Index Connector"
                href={release.connectorUrl}
                sha256={release.connectorSha256}
              />
            </div>
            <a
              href={release.metadataUrl}
              className="inline-block text-sm font-medium text-[#041729] hover:text-[#0a2d4a] transition-colors mb-8"
            >
              Signed release metadata
            </a>
          </>
        ) : (
          <div className="rounded border border-gray-200 bg-white/60 px-5 py-4 mb-8">
            <p className="font-medium text-gray-800">Download unavailable</p>
            <p className="mt-1 text-sm text-gray-600">
              A complete verified macOS release has not been configured.
            </p>
          </div>
        )}

        <div>
          <a
            href="/"
            className="inline-block text-sm text-gray-500 hover:text-gray-900 transition-colors"
          >
            Back to Index
          </a>
        </div>
      </div>
    </div>
  );
}

export const Component = Download;
