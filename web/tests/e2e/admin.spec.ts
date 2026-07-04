import { test, expect } from '@playwright/test';
import { loadWorld, loginAs } from './helpers';

test.describe('Admin — event & tower management', () => {
  test('admin home lists Operations and Setup sections with links to every admin area', async ({ page }) => {
    const world = loadWorld();
    await loginAs(page, world.users.adminMobile);
    await expect(page.getByRole('heading', { name: /^admin$/i })).toBeVisible();
    for (const label of [/dashboard/i, /representatives/i, /admins/i, /sadya reps/i, /events.*config/i, /towers/i]) {
      await expect(page.getByRole('heading', { name: label })).toBeVisible();
    }
  });

  test('admin can see the seeded test towers, including the empty-queue tower', async ({ page }) => {
    const world = loadWorld();
    await loginAs(page, world.users.adminMobile);
    await page.goto('/admin/towers');
    await expect(page.getByRole('heading', { name: /towers/i })).toBeVisible();
    for (const code of ['TTA', 'TTB', 'TTC', 'TTD']) {
      await expect(page.getByText(code)).toBeVisible();
    }
  });

  test('admin can see the seeded test event in Events & Config', async ({ page }) => {
    const world = loadWorld();
    await loginAs(page, world.users.adminMobile);
    await page.goto('/admin/events');
    await expect(page.getByText(/onam.*test|test.*event/i)).toBeVisible();
  });

  test('a non-admin (tower rep) cannot reach any /admin/* route', async ({ page }) => {
    const world = loadWorld();
    await loginAs(page, world.users.repMultiMobile);
    await page.goto('/admin/towers');
    await expect(page).toHaveURL(/\/rep$/);
  });
});
