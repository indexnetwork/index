import path from 'path';

export type UploadsKind = 'files' | 'links' | 'avatars';
export type TempKind = 'sync' | 'vibecheck' | 'links-temp';

// Resolve the absolute path to the uploads root directory.
export function getUploadsRoot(): string {
  // Allow overriding via env; default to CWD/uploads (CWD is protocol/ in dev)
  const root = process.env.UPLOADS_ROOT
    ? path.resolve(process.env.UPLOADS_ROOT)
    : path.resolve(process.cwd(), 'uploads');
  return root;
}

// Resolve an absolute path under uploads for a given kind (e.g., 'files'|'links'|'avatars') and optional userId
export function getUploadsPath(kind: UploadsKind, userId?: string): string {
  const base = path.join(getUploadsRoot(), kind);
  return userId ? path.join(base, userId) : base;
}

// Resolve an absolute path under uploads/temp for temporary files
export function getTempPath(kind: TempKind, suffix?: string): string {
  const base = path.join(getUploadsRoot(), 'temp', kind);
  return suffix ? path.join(base, suffix) : base;
}
