import type { UserSocial } from '../../../platform/database.js';

/**
 * Infers a canonical social label from a URL or handle string.
 *
 * @param value - A URL or plain handle string.
 * @returns One of `'linkedin' | 'twitter' | 'github' | 'telegram' | 'custom'`.
 */
export function detectSocialLabel(value: string): string {
  const lower = value.toLowerCase();
  if (lower.includes('linkedin.com')) return 'linkedin';
  if (lower.includes('x.com') || lower.includes('twitter.com')) return 'twitter';
  if (lower.includes('github.com')) return 'github';
  if (lower.includes('t.me') || lower.includes('telegram.me')) return 'telegram';
  return 'custom';
}

/** Flat enrichment request shape produced from a UserSocial array. */
export interface EnrichmentRequest {
  linkedin?: string;
  twitter?: string;
  github?: string;
  telegram?: string;
  websites?: string[];
}

/**
 * Converts a `UserSocial[]` array into the flat shape expected by enrichment tools.
 * Custom-labelled entries are collected into `websites[]`.
 *
 * @param socials - Row array from `user_socials`.
 * @returns Flat enrichment request object (omits keys that have no value).
 */
export function socialsToEnrichmentRequest(socials: UserSocial[]): EnrichmentRequest {
  const result: EnrichmentRequest = {};
  for (const s of socials) {
    switch (s.label) {
      case 'linkedin':
        result.linkedin = s.value;
        break;
      case 'twitter':
        result.twitter = s.value;
        break;
      case 'github':
        result.github = s.value;
        break;
      case 'telegram':
        result.telegram = s.value;
        break;
      case 'custom': {
        if (!result.websites) result.websites = [];
        result.websites.push(s.value);
        break;
      }
    }
  }
  return result;
}
