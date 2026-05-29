import type { NetworkPermissionsState, OnboardingState, ProfileEnrichmentPolicy } from '../../schemas/database.schema';

/**
 * Normalize nullable or untrusted network policy values to the backwards-compatible default.
 * @param raw - Raw permission value read from JSON.
 * @returns A valid profile enrichment policy.
 */
export function normalizeProfileEnrichmentPolicy(raw: unknown): ProfileEnrichmentPolicy {
  return raw === 'consent_required' || raw === 'disabled' || raw === 'auto' ? raw : 'auto';
}

/**
 * Returns true when onboarding state contains granted public-profile lookup consent.
 * @param onboarding - User onboarding JSON.
 * @returns Whether public lookup consent was explicitly granted.
 */
export function hasPublicProfileLookupConsent(onboarding: OnboardingState | null | undefined): boolean {
  return onboarding?.privacy?.publicProfileLookup?.granted === true;
}

/**
 * Returns true when onboarding state contains granted EdgeOS import consent.
 * @param onboarding - User onboarding JSON.
 * @returns Whether EdgeOS import consent was explicitly granted.
 */
export function hasEdgeosImportConsent(onboarding: OnboardingState | null | undefined): boolean {
  return onboarding?.privacy?.edgeosImport?.granted === true;
}

/**
 * Extract and normalize the profile enrichment policy from a network permissions JSON object.
 * @param permissions - Network permissions JSON.
 * @returns A normalized profile enrichment policy.
 */
export function getProfileEnrichmentPolicy(
  permissions: NetworkPermissionsState | Record<string, unknown> | null | undefined,
): ProfileEnrichmentPolicy {
  return normalizeProfileEnrichmentPolicy(permissions?.profileEnrichment);
}

/**
 * Checks whether a policy requires explicit consent before public profile enrichment.
 * @param policy - Raw or normalized policy.
 * @returns Whether consent is required.
 */
export function isConsentRequiredPolicy(policy: unknown): boolean {
  return normalizeProfileEnrichmentPolicy(policy) === 'consent_required';
}

/**
 * Decide whether public profile enrichment may run for a user under a network policy.
 * @param input - Policy, onboarding state, and ghost-user flag.
 * @returns Whether external/public enrichment may run.
 */
export function canRunPublicProfileEnrichment(input: {
  policy: unknown;
  onboarding: OnboardingState | null | undefined;
  isGhost: boolean;
}): boolean {
  const policy = normalizeProfileEnrichmentPolicy(input.policy);
  if (policy === 'disabled') return false;
  if (policy === 'auto') return true;
  if (input.isGhost) return false;
  return hasPublicProfileLookupConsent(input.onboarding);
}
