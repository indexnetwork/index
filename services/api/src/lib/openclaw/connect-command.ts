/**
 * Builds the `openclaw index connect` CLI command that bootstraps a self-
 * hosted OpenClaw agent against this deployment. The `--url` flag is omitted
 * when the deployment URL equals the production index.network host, so the
 * default-baked-in URL is used.
 */
export const buildConnectCommand = (apiKey: string): string => {
  const baseUrl = (process.env.FRONTEND_URL || process.env.APP_URL || '').replace(/\/+$/, '');
  const urlFlag = baseUrl && baseUrl !== 'https://index.network' ? ` --url ${baseUrl}` : '';
  return `openclaw index connect --api-key ${apiKey}${urlFlag}`;
};
