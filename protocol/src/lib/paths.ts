import path from 'path';

export type UploadsKind = 'files' | 'links';

// Resolve the absolute path to the uploads root directory.
export function getUploadsRoot(): string {
  // Allow overriding via env; default to CWD/uploads (CWD is protocol/ in dev)
  const root = process.env.UPLOADS_ROOT
    ? path.resolve(process.env.UPLOADS_ROOT)
    : path.resolve(process.cwd(), 'uploads');
  return root;
}

// Resolve an absolute path under uploads for a given kind (e.g., 'files'|'links') and optional userId
export function getUploadsPath(kind: UploadsKind, userId?: string): string {
  const base = path.join(getUploadsRoot(), kind);
  return userId ? path.join(base, userId) : base;
}
