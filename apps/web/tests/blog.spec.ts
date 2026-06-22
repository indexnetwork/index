/**
 * Unit tests for the blog utility functions (src/lib/blog.ts).
 */
import { describe, test, expect, vi, beforeEach } from 'vitest';
import { getAllPosts, getPostBySlug } from '@/lib/blog';

describe('blog utilities', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('getAllPosts', () => {
    test('returns parsed and date-sorted array when fetch succeeds', async () => {
      const mockPosts = [
        { slug: 'older-post', title: 'Older Post', date: '2025-01-01' },
        { slug: 'newer-post', title: 'Newer Post', date: '2025-06-15' },
      ];

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockPosts),
      });

      const posts = await getAllPosts();

      expect(posts).toHaveLength(2);
      // Newer post should come first (sorted by date descending)
      expect(posts[0].slug).toBe('newer-post');
      expect(posts[1].slug).toBe('older-post');
      expect(fetch).toHaveBeenCalledWith('/blog/posts.json');
    });

    test('returns empty array when fetch returns non-ok response', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        json: () => Promise.reject(new Error('not ok')),
      });

      const posts = await getAllPosts();
      expect(posts).toEqual([]);
    });

    test('returns empty array when fetch throws', async () => {
      global.fetch = vi.fn().mockRejectedValue(new Error('network error'));

      const posts = await getAllPosts();
      expect(posts).toEqual([]);
    });
  });

  describe('getPostBySlug', () => {
    test('parses markdown with frontmatter correctly', async () => {
      const markdown = `---
title: "Hello World"
date: "2025-03-01"
description: "A test post"
image: "cover.jpg"
---

This is the **content** of the post.`;

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(markdown),
      });

      const post = await getPostBySlug('hello-world');

      expect(post).not.toBeNull();
      expect(post!.slug).toBe('hello-world');
      expect(post!.title).toBe('Hello World');
      expect(post!.date).toBe('2025-03-01');
      expect(post!.description).toBe('A test post');
      // Relative image path should be prefixed with /blog/slug/
      expect(post!.image).toBe('/blog/hello-world/cover.jpg');
      expect(post!.content).toContain('**content**');
      expect(fetch).toHaveBeenCalledWith('/blog/hello-world/index.md');
    });

    test('transforms relative image paths in content', async () => {
      const markdown = `---
title: "Images Test"
date: "2025-03-01"
---

![screenshot](screenshot.png)

Some text with ![another|small](photo.jpg) image.`;

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(markdown),
      });

      const post = await getPostBySlug('images-test');

      expect(post).not.toBeNull();
      expect(post!.content).toContain('![screenshot](/blog/images-test/screenshot.png)');
      expect(post!.content).toContain('![another|small](/blog/images-test/photo.jpg)');
    });

    test('returns null for 404 response', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        text: () => Promise.reject(new Error('not found')),
      });

      const post = await getPostBySlug('nonexistent');
      expect(post).toBeNull();
    });

    test('returns null when fetch throws', async () => {
      global.fetch = vi.fn().mockRejectedValue(new Error('network error'));

      const post = await getPostBySlug('error-slug');
      expect(post).toBeNull();
    });

    test('uses defaults for missing frontmatter fields', async () => {
      const markdown = `---
---

Just content, no metadata.`;

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(markdown),
      });

      const post = await getPostBySlug('minimal');

      expect(post).not.toBeNull();
      expect(post!.title).toBe('Untitled');
      // date should default to today's date format
      expect(post!.date).toBeTruthy();
    });
  });
});
