import { describe, it, expect } from 'bun:test';
import { detectSocialLabel, socialsToEnrichmentRequest } from '../social-label';

describe('detectSocialLabel', () => {
  it('detects linkedin URLs', () => {
    expect(detectSocialLabel('https://linkedin.com/in/johndoe')).toBe('linkedin');
    expect(detectSocialLabel('https://www.linkedin.com/in/johndoe')).toBe('linkedin');
  });

  it('detects twitter/x URLs', () => {
    expect(detectSocialLabel('https://x.com/johndoe')).toBe('twitter');
    expect(detectSocialLabel('https://twitter.com/johndoe')).toBe('twitter');
  });

  it('detects github URLs', () => {
    expect(detectSocialLabel('https://github.com/johndoe')).toBe('github');
  });

  it('detects telegram URLs', () => {
    expect(detectSocialLabel('https://t.me/johndoe')).toBe('telegram');
    expect(detectSocialLabel('https://telegram.me/johndoe')).toBe('telegram');
  });

  it('returns custom for unknown URLs', () => {
    expect(detectSocialLabel('https://myblog.com')).toBe('custom');
    expect(detectSocialLabel('johndoe')).toBe('custom');
  });

  it('is case-insensitive', () => {
    expect(detectSocialLabel('https://LINKEDIN.COM/in/foo')).toBe('linkedin');
    expect(detectSocialLabel('https://GitHub.com/foo')).toBe('github');
  });
});

describe('socialsToEnrichmentRequest', () => {
  it('converts UserSocial[] to flat enrichment shape', () => {
    const socials = [
      { id: '1', userId: 'u1', label: 'linkedin', value: 'johndoe' },
      { id: '2', userId: 'u1', label: 'twitter', value: 'johndoe' },
      { id: '3', userId: 'u1', label: 'github', value: 'johndoe' },
      { id: '4', userId: 'u1', label: 'custom', value: 'https://myblog.com' },
    ];
    const result = socialsToEnrichmentRequest(socials);
    expect(result).toEqual({
      linkedin: 'johndoe',
      twitter: 'johndoe',
      github: 'johndoe',
      websites: ['https://myblog.com'],
    });
  });

  it('returns empty object for empty array', () => {
    expect(socialsToEnrichmentRequest([])).toEqual({});
  });

  it('collects multiple custom entries into websites array', () => {
    const socials = [
      { id: '1', userId: 'u1', label: 'custom', value: 'https://a.com' },
      { id: '2', userId: 'u1', label: 'custom', value: 'https://b.com' },
    ];
    const result = socialsToEnrichmentRequest(socials);
    expect(result).toEqual({ websites: ['https://a.com', 'https://b.com'] });
  });

  it('includes telegram in output', () => {
    const socials = [
      { id: '1', userId: 'u1', label: 'telegram', value: 'johndoe' },
    ];
    const result = socialsToEnrichmentRequest(socials);
    expect(result).toEqual({ telegram: 'johndoe' });
  });
});
