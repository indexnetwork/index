/**
 * Unit tests for ScraperAdapter (scrape, extractUrlContent).
 * Mocks lib/parallel so no PARALLELS_API_KEY or network is required.
 */
/** Config */
import { config } from "dotenv";
config({ path: '.env.test' });

import { describe, expect, it, beforeAll, beforeEach, afterAll, mock } from 'bun:test';

const mockSearchUser = mock(async (_request: { objective: string }) => ({
  search_id: 'mock-search-id',
  results: [
    { url: 'https://example.com/page', title: 'Example Page', publish_date: null, excerpts: ['Excerpt one.', 'Excerpt two.'] },
  ],
}));

const mockExtractUrlContent = mock(async (url: string) => `Extracted content from ${url}`);

const { extractHandle: realExtractHandle } = await import('../../lib/parallel/parallel');

mock.module('../../lib/parallel/parallel', () => ({
  searchUser: mockSearchUser,
  extractUrlContent: mockExtractUrlContent,
  enrichUserProfile: mock(async () => null),
  extractHandle: realExtractHandle,
  crawlLinksForIndex: mock(async () => ({ files: [] })),
  parallelClient: null,
}));

afterAll(() => {
  mock.restore();
});

let ScraperAdapter: typeof import('../scraper.adapter').ScraperAdapter;
beforeAll(async () => {
  const mod = await import('../scraper.adapter');
  ScraperAdapter = mod.ScraperAdapter;
});

describe('ScraperAdapter', () => {
  beforeEach(() => {
    mockSearchUser.mockClear();
    mockExtractUrlContent.mockClear();
  });

  describe('scrape', () => {
    it('should call searchUser with objective and return formatted results', async () => {
      const adapter = new ScraperAdapter();
      const result = await adapter.scrape('Find React developers in Berlin');

      expect(mockSearchUser).toHaveBeenCalledTimes(1);
      expect(mockSearchUser).toHaveBeenCalledWith({ objective: 'Find React developers in Berlin' });
      expect(result).toContain('Objective:');
      expect(result).toContain('Find React developers in Berlin');
      expect(result).toContain('Search Results:');
      expect(result).toContain('Example Page');
      expect(result).toContain('Excerpt one.');
    });

    it('should return message when search returns no results', async () => {
      mockSearchUser.mockResolvedValueOnce({ search_id: 'empty', results: [] });
      const adapter = new ScraperAdapter();
      const result = await adapter.scrape('Empty objective');

      expect(result).toContain('No information found for objective: Empty objective');
    });

    it('should return objective and error message when searchUser throws', async () => {
      mockSearchUser.mockRejectedValueOnce(new Error('API rate limit'));
      const adapter = new ScraperAdapter();
      const result = await adapter.scrape('Failing objective');

      expect(result).toContain('Failing objective');
      expect(result).toContain('Search failed:');
      expect(result).toContain('API rate limit');
    });
  });

  describe('extractUrlContent', () => {
    it('should use extractUrlContent for non-profile URLs when objective is not profile', async () => {
      const adapter = new ScraperAdapter();
      const result = await adapter.extractUrlContent('https://github.com/user/repo', {
        objective: 'Create an intent from this repo',
      });

      expect(mockExtractUrlContent).toHaveBeenCalledTimes(1);
      expect(mockExtractUrlContent).toHaveBeenCalledWith('https://github.com/user/repo', {
        objective: 'Create an intent from this repo',
      });
      expect(result).toBe('Extracted content from https://github.com/user/repo');
    });

    it('should use searchUser for LinkedIn URLs and return formatted content', async () => {
      mockSearchUser.mockResolvedValueOnce({
        search_id: 'li',
        results: [
          { url: 'https://linkedin.com/in/jane', title: 'Jane Doe', publish_date: null, excerpts: ['Software lead at X.'] },
        ],
      });
      const adapter = new ScraperAdapter();
      const result = await adapter.extractUrlContent('https://www.linkedin.com/in/jane');

      expect(mockSearchUser).toHaveBeenCalledTimes(1);
      expect(mockSearchUser).toHaveBeenCalledWith(
        expect.objectContaining({
          objective: expect.stringContaining('profile page'),
        })
      );
      expect(result).toContain('Jane Doe');
      expect(result).toContain('Software lead at X.');
    });

    it('should use searchUser when objective is profile-related and URL is provided', async () => {
      mockSearchUser.mockResolvedValueOnce({
        search_id: 'prof',
        results: [
          { url: 'https://example.com/me', title: 'My Profile', publish_date: null, excerpts: ['Bio text.'] },
        ],
      });
      const adapter = new ScraperAdapter();
      const result = await adapter.extractUrlContent('https://example.com/me', {
        objective: 'update my profile from this page',
      });

      expect(mockSearchUser).toHaveBeenCalledTimes(1);
      expect(result).toContain('My Profile');
      expect(result).toContain('Bio text.');
    });

    it('should fall back to extractUrlContent when searchUser fails for profile URL', async () => {
      mockSearchUser.mockRejectedValueOnce(new Error('Search failed'));
      const adapter = new ScraperAdapter();
      const result = await adapter.extractUrlContent('https://linkedin.com/in/fallback');

      expect(mockSearchUser).toHaveBeenCalledTimes(1);
      expect(mockExtractUrlContent).toHaveBeenCalledWith('https://linkedin.com/in/fallback', undefined);
      expect(result).toBe('Extracted content from https://linkedin.com/in/fallback');
    });

    it('should pass optional objective to extract when not using search', async () => {
      const adapter = new ScraperAdapter();
      await adapter.extractUrlContent('https://example.com/doc', { objective: 'Summarize for intent' });

      expect(mockExtractUrlContent).toHaveBeenCalledWith('https://example.com/doc', {
        objective: 'Summarize for intent',
      });
    });
  });
});
