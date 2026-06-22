import { test, expect } from '@playwright/test';

test.describe('Blog smoke tests', () => {
  test('blog listing shows posts', async ({ page }) => {
    await page.goto('/blog');
    // Should show multiple blog post titles
    await expect(page.getByText('Intent is the New Search')).toBeVisible();
    await expect(page.getByText('The Magic Factory')).toBeVisible();
  });

  test('clicking a blog post navigates to its page', async ({ page }) => {
    await page.goto('/blog');
    // Click the first blog post link
    await page.getByText('Intent is the New Search').click();
    await expect(page).toHaveURL('/blog/intent-is-the-new-search');
  });

  test('blog post page renders markdown content', async ({ page }) => {
    await page.goto('/blog/intent-is-the-new-search');
    // The post title should be visible
    await expect(page.getByText('Intent is the New Search')).toBeVisible();
    // The post should have rendered content (not just a loading state)
    // Check that the article area has substantial text
    await expect(page.locator('body')).toContainText('intent');
  });

  test('blog post page for another slug loads', async ({ page }) => {
    await page.goto('/blog/the-magic-factory');
    await expect(page.getByRole('heading', { name: 'The Magic Factory' })).toBeVisible();
  });
});
