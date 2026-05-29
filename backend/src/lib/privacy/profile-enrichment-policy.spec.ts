import { describe, expect, it } from 'bun:test';

import {
  canRunPublicProfileEnrichment,
  hasEdgeosImportConsent,
  hasPublicProfileLookupConsent,
  isConsentRequiredPolicy,
  normalizeProfileEnrichmentPolicy,
} from './profile-enrichment-policy';
import type { OnboardingState } from '../../schemas/database.schema';

const granted: OnboardingState = {
  privacy: {
    publicProfileLookup: {
      granted: true,
      decidedAt: '2026-05-29T00:00:00.000Z',
      source: 'agentvillage_onboarding',
    },
    edgeosImport: {
      granted: true,
      decidedAt: '2026-05-29T00:00:00.000Z',
      source: 'agentvillage_onboarding',
    },
  },
};

describe('profile enrichment policy helpers', () => {
  it('defaults missing or unknown policies to auto', () => {
    expect(normalizeProfileEnrichmentPolicy(undefined)).toBe('auto');
    expect(normalizeProfileEnrichmentPolicy('bogus')).toBe('auto');
    expect(normalizeProfileEnrichmentPolicy('consent_required')).toBe('consent_required');
  });

  it('reads public lookup and EdgeOS import consent independently', () => {
    expect(hasPublicProfileLookupConsent(granted)).toBe(true);
    expect(hasEdgeosImportConsent(granted)).toBe(true);
    expect(hasPublicProfileLookupConsent({ privacy: { publicProfileLookup: { ...granted.privacy!.publicProfileLookup!, granted: false } } })).toBe(false);
  });

  it('allows auto policy and blocks disabled policy', () => {
    expect(canRunPublicProfileEnrichment({ policy: undefined, onboarding: undefined, isGhost: false })).toBe(true);
    expect(canRunPublicProfileEnrichment({ policy: 'disabled', onboarding: granted, isGhost: false })).toBe(false);
  });

  it('requires public lookup consent under consent_required', () => {
    expect(isConsentRequiredPolicy('consent_required')).toBe(true);
    expect(canRunPublicProfileEnrichment({ policy: 'consent_required', onboarding: {}, isGhost: false })).toBe(false);
    expect(canRunPublicProfileEnrichment({ policy: 'consent_required', onboarding: granted, isGhost: false })).toBe(true);
  });

  it('never allows ghosts under consent_required because ghosts cannot consent', () => {
    expect(canRunPublicProfileEnrichment({ policy: 'consent_required', onboarding: granted, isGhost: true })).toBe(false);
  });
});
