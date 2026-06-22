import Papa from 'papaparse';

export interface ImportRow {
  email: string;
  name?: string;
  bio?: string;
  location?: string;
  socials: { label: string; value: string }[];
}

export interface ParsedCsvResult {
  valid: ImportRow[];
  invalid: { row: Record<string, string>; reason: string }[];
  hasEmailColumn: boolean;
  columns: string[];
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const KNOWN_COLS = new Set(['email', 'name', 'bio', 'location']);

export function parseCsvText(text: string): ParsedCsvResult {
  const parsed = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.toLowerCase().trim(),
  });

  const headers = parsed.meta.fields ?? [];
  const hasEmailColumn = headers.includes('email');
  if (!hasEmailColumn) {
    return { valid: [], invalid: [], hasEmailColumn: false, columns: headers };
  }

  const valid: ImportRow[] = [];
  const invalid: ParsedCsvResult['invalid'] = [];

  for (const row of parsed.data) {
    const email = (row['email'] || '').toLowerCase().trim();
    if (!email) {
      invalid.push({ row, reason: 'Missing email' });
      continue;
    }
    if (!EMAIL_RE.test(email)) {
      invalid.push({ row, reason: 'Invalid email format' });
      continue;
    }

    const socials: { label: string; value: string }[] = [];
    for (const [key, val] of Object.entries(row)) {
      if (!KNOWN_COLS.has(key) && val?.trim()) {
        socials.push({ label: key, value: val.trim() });
      }
    }

    valid.push({
      email,
      name: row['name']?.trim() || undefined,
      bio: row['bio']?.trim() || undefined,
      location: row['location']?.trim() || undefined,
      socials,
    });
  }

  return { valid, invalid, hasEmailColumn: true, columns: headers };
}
