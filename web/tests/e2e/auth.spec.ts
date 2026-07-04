import { test, expect } from '@playwright/test';
import { loadWorld, loginAs } from './helpers';

test.describe('Authentication', () => {
  test('a resident can log in with mobile + password and lands on /home', async ({ page }) => {
    const world = loadWorld();
    await loginAs(page, world.users.residentA[3]);
    await expect(page).toHaveURL(/\/home$/);
  });

  test('an admin logging in lands on /admin, not the resident home', async ({ page }) => {
    const world = loadWorld();
    await loginAs(page, world.users.adminMobile);
    await expect(page).toHaveURL(/\/admin$/);
  });

  test('a tower rep logging in lands on /rep', async ({ page }) => {
    const world = loadWorld();
    await loginAs(page, world.users.repMultiMobile);
    await expect(page).toHaveURL(/\/rep$/);
  });

  test('wrong password shows an error and does not navigate away from /login', async ({ page }) => {
    const world = loadWorld();
    await loginAs(page, world.users.residentA[3], 'definitely-the-wrong-password');
    await expect(page.getByText(/error|invalid|incorrect/i)).toBeVisible();
    await expect(page).toHaveURL(/\/login$/);
  });

  test('session persists across a full page reload', async ({ page }) => {
    const world = loadWorld();
    await loginAs(page, world.users.residentA[3]);
    await expect(page).toHaveURL(/\/home$/);
    await page.reload();
    await expect(page).toHaveURL(/\/home$/);
    await expect(page.getByText(/log in/i)).toHaveCount(0);
  });

  test('logout returns to the login page and blocks access to protected routes', async ({ page }) => {
    const world = loadWorld();
    await loginAs(page, world.users.residentA[3]);
    await expect(page).toHaveURL(/\/home$/);

    await page.goto('/profile');
    await page.getByRole('button', { name: /log out/i }).click();
    await expect(page).toHaveURL(/\/login$/);

    // Directly requesting a protected route after logout must bounce to /login.
    await page.goto('/home');
    await expect(page).toHaveURL(/\/login$/);
  });

  test('a resident cannot reach an admin-only route (redirected home)', async ({ page }) => {
    const world = loadWorld();
    await loginAs(page, world.users.residentA[3]);
    await page.goto('/admin/towers');
    await expect(page).toHaveURL(/\/home$/);
  });
});
