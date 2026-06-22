export function getCorsHeaders(req: Request): Record<string, string> {
  const headers: Record<string, string> = {
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With, Accept',
    'Access-Control-Expose-Headers': 'X-Session-Id, set-auth-jwt',
    'Access-Control-Max-Age': '86400',
  };

  const origin = req.headers.get('Origin');
  if (origin) {
    headers['Access-Control-Allow-Origin'] = origin;
    headers['Access-Control-Allow-Credentials'] = 'true';
  }

  return headers;
}

/** Trusted origins for Better Auth from TRUSTED_ORIGINS env var plus request Origin. */
export async function getTrustedOrigins(request?: Request): Promise<string[]> {
  const origins = new Set<string>();

  const envOrigins = process.env.TRUSTED_ORIGINS;
  if (envOrigins) {
    for (const o of envOrigins.split(',')) {
      const trimmed = o.trim();
      if (trimmed) origins.add(trimmed);
    }
  }

  const reqOrigin = request?.headers?.get?.('Origin');
  if (reqOrigin) origins.add(reqOrigin);

  return [...origins];
}
