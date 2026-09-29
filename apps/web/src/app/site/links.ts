/** Outbound links shared by the public marketing pages. */

const MAC_TAG = import.meta.env.VITE_PROTOCOL_URL?.includes("dev.") ? "mac-dev" : "mac";

export const MAC_APP_DOWNLOAD_URL = `https://github.com/indexnetwork/mac-client/releases/download/${MAC_TAG}/Index.dmg`;
export const HERMES_INSTALL_URL = "hermes://plugin/install?repo=indexnetwork/hermes-plugin&enable=1";
export const HERMES_INSTALL_COMMAND = "hermes plugins install indexnetwork/hermes-plugin";
export const HERMES_AGENT_URL = "https://hermes-agent.nousresearch.com/";

export const EARLY_ACCESS_PATH = "/download";
export const CONTACT_EMAIL = "founders@index.network";
export const GITHUB_URL = "https://github.com/indexnetwork/index";
export const X_URL = "https://x.com/indexnetwork_";

export const DOCS_URL = "https://docs.index.network";
export const docsUrl = (path: string) => `${DOCS_URL}${path}`;
