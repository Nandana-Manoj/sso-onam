import { test, expect } from '@playwright/test';
import { loadWorld, loginAs } from './helpers';

test.describe('Resident — contribution', () => {
  test.beforeEach(() => {
    // These pages only render once an event is active. seedWorld() only
    // activates the sentinel test event if nothing else is active on this
    // project (never clobbers a real active event) — if that happened, skip
    // rather than fail confusingly. See fixtures/world.ts.
    const world = loadWorld();
    test.skip(!world.event.makeActive, 'Another event is already active on this project — sentinel event was seeded inactive.');
  });

  test('a resident with a payment_pending contribution can submit payment for verification', async ({ page }) => {
    const world = loadWorld();
    await loginAs(page, world.users.residentA[1]); // flat 101, seeded payment_pending
    await expect(page.getByRole('heading', { name: /flat contribution/i })).toBeVisible();
    await expect(page.getByText(/pledged/i)).toBeVisible();

    await page.getByLabel(/utr.*reference/i).fill('E2E-TEST-UTR');
    await page.getByRole('button', { name: /submit for verification/i }).click();

    await expect(page.getByText(/awaiting verification/i)).toBeVisible();
  });

  test('a resident whose contribution is already verified sees a confirmation and can request a refund', async ({ page }) => {
    const world = loadWorld();
    await loginAs(page, world.users.residentA[3]); // flat 103, seeded verified
    await expect(page.getByText(/thank you/i)).toBeVisible();
    await expect(page.getByRole('button', { name: /cancel.*request refund/i })).toBeVisible();
  });

  test('a resident whose contribution was rejected sees the reason and can start a new one', async ({ page }) => {
    const world = loadWorld();
    await loginAs(page, world.users.residentA[4]); // flat 104, seeded rejected
    await expect(page.getByText(/previous attempt was rejected/i)).toBeVisible();
    await expect(page.getByRole('button', { name: /start contribution/i })).toBeVisible();
  });
});
