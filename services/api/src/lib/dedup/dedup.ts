/**
 * Jaro-Winkler string similarity score (0.0–1.0).
 * Higher scores indicate greater similarity. Favors prefix matches.
 *
 * @param s1 - First string
 * @param s2 - Second string
 * @returns Similarity score between 0.0 and 1.0
 */
export function jaroWinkler(s1: string, s2: string): number {
  if (s1.length === 0 || s2.length === 0) return 0.0;
  if (s1 === s2) return 1.0;

  const maxDist = Math.floor(Math.max(s1.length, s2.length) / 2) - 1;
  const s1Matches = new Array(s1.length).fill(false);
  const s2Matches = new Array(s2.length).fill(false);

  let matches = 0;
  let transpositions = 0;

  for (let i = 0; i < s1.length; i++) {
    const start = Math.max(0, i - maxDist);
    const end = Math.min(i + maxDist + 1, s2.length);
    for (let j = start; j < end; j++) {
      if (s2Matches[j] || s1[i] !== s2[j]) continue;
      s1Matches[i] = true;
      s2Matches[j] = true;
      matches++;
      break;
    }
  }

  if (matches === 0) return 0.0;

  let k = 0;
  for (let i = 0; i < s1.length; i++) {
    if (!s1Matches[i]) continue;
    while (!s2Matches[k]) k++;
    if (s1[i] !== s2[k]) transpositions++;
    k++;
  }

  const jaro = (matches / s1.length + matches / s2.length + (matches - transpositions / 2) / matches) / 3;

  // Winkler boost: up to 4 shared prefix characters
  let prefix = 0;
  for (let i = 0; i < Math.min(4, s1.length, s2.length); i++) {
    if (s1[i] === s2[i]) prefix++;
    else break;
  }

  return jaro + prefix * 0.1 * (1 - jaro);
}

/** Common email providers where domain match is meaningless. */
const COMMON_PROVIDERS = new Set([
  'gmail.com', 'googlemail.com',
  'outlook.com', 'hotmail.com', 'live.com', 'msn.com',
  'yahoo.com', 'ymail.com',
  'icloud.com', 'me.com', 'mac.com',
  'aol.com',
  'proton.me', 'protonmail.com',
  'zoho.com',
  'mail.com',
  'gmx.com', 'gmx.net',
  'fastmail.com',
  'tutanota.com', 'tuta.io',
  'yandex.com', 'yandex.ru',
]);

/**
 * Checks if an email domain is a common provider (domain match is meaningless).
 *
 * @param domain - Lowercase email domain
 * @returns True if the domain is a common email provider
 */
export function isCommonProvider(domain: string): boolean {
  return COMMON_PROVIDERS.has(domain);
}

/**
 * Computes email similarity by comparing local-parts with Jaro-Winkler,
 * then adding a domain bonus for matching custom domains.
 *
 * @param email1 - First email (lowercase)
 * @param email2 - Second email (lowercase)
 * @param domainBonus - Bonus to add when custom domains match
 * @returns Similarity score between 0.0 and 1.0
 */
export function emailSimilarity(email1: string, email2: string, domainBonus: number): number {
  if (!email1.includes('@') || !email2.includes('@')) return jaroWinkler(email1, email2);

  const [local1, domain1] = email1.split('@');
  const [local2, domain2] = email2.split('@');

  const localScore = jaroWinkler(local1, local2);

  const customMatch = !isCommonProvider(domain1) && !isCommonProvider(domain2) && domain1 === domain2;

  // When custom domains match, amplify the bonus for low local-part scores.
  // Formula: localScore + domainBonus * (2 - localScore). The multiplier exceeds 1.0
  // for localScore < 1.0, so the effective boost is stronger than a flat additive.
  // Note: with aggressive preset (domainBonus=0.35), any same-domain pair merges.
  if (customMatch) {
    return Math.min(1.0, localScore + domainBonus * (2 - localScore));
  }
  return localScore;
}

/** Threshold configuration for a dedup preset. */
export interface DedupPreset {
  nameThreshold: number;
  emailThreshold: number;
  domainBonus: number;
}

const PRESETS: Record<string, DedupPreset> = {
  conservative: { nameThreshold: 0.92, emailThreshold: 0.85, domainBonus: 0.25 },
  balanced:     { nameThreshold: 0.85, emailThreshold: 0.75, domainBonus: 0.30 },
  aggressive:   { nameThreshold: 0.78, emailThreshold: 0.65, domainBonus: 0.35 },
};

/**
 * Resolves a strategy string to a preset, or null if dedup is disabled.
 *
 * @param strategy - Environment variable value (conservative|balanced|aggressive|off)
 * @returns Preset thresholds, or null if strategy is "off"
 */
export function getPreset(strategy: string | undefined): DedupPreset | null {
  if (strategy === 'off') return null;
  return PRESETS[strategy ?? ''] ?? PRESETS.conservative;
}

/** Result of contact deduplication. */
export interface DedupResult {
  kept: Array<{ email: string; userId: string; isNew: boolean }>;
  removed: Array<{
    email: string;
    userId: string;
    matchedWith: string;
    nameScore: number;
    emailScore: number;
  }>;
}

/**
 * Deduplicates resolved contact details using name + email similarity scoring.
 * Both name and email must independently pass their thresholds for a pair to
 * be considered duplicates. First contact in import order is kept.
 *
 * @param contacts - Original import input (provides name-to-email mapping)
 * @param details - Resolved details from resolveUsers (email, userId, isNew)
 * @param preset - Threshold config, or null to disable dedup
 * @returns Kept and removed contacts with scores for removed entries
 */
export function deduplicateContacts(
  contacts: Array<{ name?: string; email: string }>,
  details: Array<{ email: string; userId: string; isNew: boolean }>,
  preset: DedupPreset | null,
): DedupResult {
  if (!preset || details.length <= 1) {
    return { kept: [...details], removed: [] };
  }

  // Build email → normalized name map
  // Fall back to the local-part of the email when name is empty, so that a long
  // shared test-prefix (or real shared domain) does not inflate Jaro-Winkler scores.
  const emailToName = new Map<string, string>();
  for (const c of contacts) {
    const email = c.email.toLowerCase().trim();
    if (!emailToName.has(email)) {
      const name = c.name?.trim();
      const localPart = email.split('@')[0] ?? email;
      emailToName.set(email, name ? name.toLowerCase().replace(/\s+/g, ' ') : localPart);
    }
  }

  const kept: DedupResult['kept'] = [];
  const removed: DedupResult['removed'] = [];
  const removedIndexes = new Set<number>();

  for (let i = 0; i < details.length; i++) {
    if (removedIndexes.has(i)) continue;

    kept.push(details[i]);
    const nameI = emailToName.get(details[i].email) ?? details[i].email;
    const emailI = details[i].email;

    for (let j = i + 1; j < details.length; j++) {
      if (removedIndexes.has(j)) continue;

      const nameJ = emailToName.get(details[j].email) ?? details[j].email;
      const emailJ = details[j].email;

      const nameScore = jaroWinkler(nameI, nameJ);
      if (nameScore < preset.nameThreshold) continue;

      const eScore = emailSimilarity(emailI, emailJ, preset.domainBonus);
      if (eScore < preset.emailThreshold) continue;

      removedIndexes.add(j);
      removed.push({
        email: details[j].email,
        userId: details[j].userId,
        matchedWith: details[i].email,
        nameScore,
        emailScore: eScore,
      });
    }
  }

  return { kept, removed };
}
