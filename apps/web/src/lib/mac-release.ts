export type MacReleaseArtifactKind = "app-dmg" | "connector-dmg";

export type MacReleaseArtifact = {
  kind: MacReleaseArtifactKind;
  name: string;
  url: string;
  sha256: string;
  size: number;
};

export type MacReleaseMetadata = {
  schemaVersion: 1;
  releaseVersion: string;
  buildNumber: string;
  commit: string;
  teamId: "LMQ3XNXLAD";
  apiUrl: "https://protocol.index.network";
  webUrl: "https://index.network";
  architectures: ["arm64", "x86_64"];
  minimumMacOS: "13.0";
  connectorProtocolVersion: 1;
  artifacts: [MacReleaseArtifact, MacReleaseArtifact];
};

const ROOT_KEYS = [
  "apiUrl", "architectures", "artifacts", "buildNumber", "commit",
  "connectorProtocolVersion", "minimumMacOS", "releaseVersion", "schemaVersion",
  "teamId", "webUrl",
].sort();
const ARTIFACT_KEYS = ["kind", "name", "sha256", "size", "url"].sort();
const SHA256 = /^[0-9a-f]{64}$/;
const VERSION = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/;
const BUILD = /^[1-9][0-9]*$/;
const COMMIT = /^[0-9a-f]{40}$/;

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, keys: string[], label: string): void {
  if (JSON.stringify(Object.keys(value).sort()) !== JSON.stringify(keys)) {
    throw new Error(`${label} has unsupported fields`);
  }
}

function immutableReleaseBase(version: string): string {
  return `https://github.com/indexnetwork/index/releases/download/v${version}`;
}

export function parseMacReleaseMetadata(value: unknown): MacReleaseMetadata {
  const root = record(value, "macOS release metadata");
  exactKeys(root, ROOT_KEYS, "macOS release metadata");
  if (root.schemaVersion !== 1 || typeof root.releaseVersion !== "string" || !VERSION.test(root.releaseVersion)) {
    throw new Error("unsupported release identity");
  }
  if (typeof root.buildNumber !== "string" || !BUILD.test(root.buildNumber)) throw new Error("invalid build number");
  if (typeof root.commit !== "string" || !COMMIT.test(root.commit)) throw new Error("invalid release commit");
  if (root.teamId !== "LMQ3XNXLAD" || root.apiUrl !== "https://protocol.index.network" || root.webUrl !== "https://index.network") {
    throw new Error("unexpected release authority");
  }
  if (JSON.stringify(root.architectures) !== JSON.stringify(["arm64", "x86_64"])) throw new Error("Universal 2 required");
  if (root.minimumMacOS !== "13.0") throw new Error("unsupported macOS floor");
  if (root.connectorProtocolVersion !== 1) throw new Error("unsupported connector protocol");
  if (!Array.isArray(root.artifacts) || root.artifacts.length !== 2) throw new Error("exact app and connector artifacts required");

  const version = root.releaseVersion;
  const approved = [
    { kind: "app-dmg", name: `Index-macOS-${version}-universal.dmg` },
    { kind: "connector-dmg", name: `IndexConnector-${version}-universal.dmg` },
  ] as const;
  const base = immutableReleaseBase(version);
  const artifacts = root.artifacts.map((raw, index) => {
    const artifact = record(raw, `artifact ${index}`);
    exactKeys(artifact, ARTIFACT_KEYS, `artifact ${index}`);
    const expected = approved[index];
    if (artifact.kind !== expected.kind || artifact.name !== expected.name || artifact.url !== `${base}/${expected.name}`) {
      throw new Error("artifact identity is not immutable");
    }
    if (typeof artifact.sha256 !== "string" || !SHA256.test(artifact.sha256)) throw new Error("artifact SHA-256 is invalid");
    if (typeof artifact.size !== "number" || !Number.isSafeInteger(artifact.size) || artifact.size <= 0) throw new Error("artifact size is invalid");
    return artifact as MacReleaseArtifact;
  });

  return { ...root, artifacts } as MacReleaseMetadata;
}

export function validateMacReleaseMetadataUrl(value: string): URL {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error("release metadata URL is invalid"); }
  if (
    url.protocol !== "https:" || url.username || url.password || url.port || url.search || url.hash ||
    url.hostname !== "github.com" ||
    !/^\/indexnetwork\/index\/releases\/download\/v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\/macos-release\.json$/.test(url.pathname)
  ) throw new Error("release metadata URL must be an immutable Index GitHub release asset");
  return url;
}

export function macReleaseCmsUrl(metadataUrl: string): string {
  const url = validateMacReleaseMetadataUrl(metadataUrl);
  url.pathname = url.pathname.replace(/macos-release\.json$/, "macos-release.cms");
  return url.toString();
}

/** Final host used by GitHub for immutable release-asset bytes after its 302. */
export function validateMacReleaseDeliveryUrl(value: string): URL {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error("release metadata delivery URL is invalid"); }
  if (
    url.protocol !== "https:" || url.username || url.password || url.port ||
    url.hostname !== "release-assets.githubusercontent.com" || url.pathname === "/"
  ) throw new Error("release metadata delivery URL is not approved");
  return url;
}

export async function loadMacReleaseMetadata(metadataUrl: string, fetcher: typeof fetch = fetch): Promise<MacReleaseMetadata> {
  const url = validateMacReleaseMetadataUrl(metadataUrl);
  const response = await fetcher(url, { cache: "no-store", credentials: "omit", redirect: "follow" });
  if (!response.ok) throw new Error("release metadata unavailable");
  if (!response.redirected || !response.url) throw new Error("release metadata immutable redirect is required");
  validateMacReleaseDeliveryUrl(response.url);
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.toLowerCase().includes("application/json")) throw new Error("release metadata content type is invalid");
  const metadata = parseMacReleaseMetadata(await response.json());
  const expectedTag = `/v${metadata.releaseVersion}/`;
  if (!url.pathname.includes(expectedTag)) throw new Error("release metadata URL/version mismatch");
  return metadata;
}
