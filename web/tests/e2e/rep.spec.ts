import { test, expect } from '@playwright/test';
import { loadWorld, loginAs } from './helpers';

test.describe('Tower Rep — payment verification', () => {
  test.beforeEach(() => {
    const world = loadWorld();
    test.skip(!world.event.makeActive, 'Another event is already active on this project — sentinel event was seeded inactive.');
  });

  test('a rep sees their own tower\'s submitted payment in the verification queue and can approve it', async ({ page }) => {
    const world = loadWorld();
    await loginAs(page, world.users.repMultiMobile);
    await page.goto('/rep/verify');

    const row = page.locator('li', { hasText: 'Flat 102' });
    await expect(row).toBeVisible();
    await row.getByRole('button', { name: /^approve$/i }).click();

    await expect(page.locator('li', { hasText: 'Flat 102' })).toHaveCount(0);
  });

  test('a rep does NOT see another tower\'s submitted payment in their queue (tower isolation, visible in the UI)', async ({ page }) => {
    const world = loadWorld();
    await loginAs(page, world.users.repMultiMobile); // reps towers A + D, not B
    await page.goto('/rep/verify');
    await expect(page.locator('li', { hasText: 'Flat 201' })).toHaveCount(0); // tower B's seeded submitted row
  });

  test('a rep can reject a payment with a reason, and the resident sees the reason', async ({ page, browser }) => {
    const world = loadWorld();
    await loginAs(page, world.users.repBMobile);
    await page.goto('/rep/verify');

    const row = page.locator('li', { hasText: 'Flat 201' });
    await row.getByRole('button', { name: /^reject$/i }).click();
    await page.getByPlaceholder(/payment not received/i).fill('E2E test rejection reason');
    await page.getByRole('button', { name: /reject payment/i }).click();
    await expect(page.locator('li', { hasText: 'Flat 201' })).toHaveCount(0);

    // A fresh, isolated browser context — context.newPage() would share this
    // page's localStorage (same origin, same context), so the resident's
    // /login visit would find repB's session already there and bounce off
    // before the form even renders.
    const residentContext = await browser.newContext();
    const residentPage = await residentContext.newPage();
    await loginAs(residentPage, world.users.residentBMobile);
    await expect(residentPage.getByText(/E2E test rejection reason/i)).toBeVisible();
    await residentContext.close();
  });
});
