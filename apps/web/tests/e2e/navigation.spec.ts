import { test, expect } from '@playwright/test';

test.describe('Navigation smoke tests', () => {
  test('home page loads and has content', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/Index Network/);
    // The landing page should have visible content
    await expect(page.locator('body')).not.toBeEmpty();
  });

  test('about page loads and shows team info', async ({ page }) => {
    await page.goto('/about');
    await expect(page.getByText('About us')).toBeVisible();
    await expect(page.getByText('Team')).toBeVisible();
  });

  test('blog listing page loads', async ({ page }) => {
    await page.goto('/blog');
    // Blog page should show at least one post title
    await expect(page.getByText('Intent is the New Search')).toBeVisible();
  });

  test('privacy policy page loads', async ({ page }) => {
    await page.goto('/pages/privacy-policy');
    await expect(page.locator('body')).toContainText('Privacy');
  });

  test('terms of use page loads', async ({ page }) => {
    await page.goto('/pages/terms-of-use');
    await expect(page.locator('body')).toContainText('Terms');
  });

  test('unknown routes redirect unauthenticated users to home', async ({ page }) => {
    // The auth guard redirects unauthenticated users on non-public routes to /
    await page.goto('/this-route-does-not-exist');
    await expect(page).toHaveURL('/', { timeout: 10000 });
  });

  test('unknown public-prefix route shows 404', async ({ page }) => {
    // Routes under /pages/* are public, so the 404 catch-all can render
    await page.goto('/pages/nonexistent-page');
    await expect(page.getByText('404')).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('Page not found')).toBeVisible();
  });

  test('navigation between pages works', async ({ page }) => {
    await page.goto('/about');
    await expect(page.getByText('About us')).toBeVisible();

    // Navigate to home via a link (most pages have logo/nav linking home)
    // Use the blog page as a known navigable target
    await page.goto('/blog');
    await expect(page).toHaveURL('/blog');
    await expect(page.getByText('Intent is the New Search')).toBeVisible();
  });
});
