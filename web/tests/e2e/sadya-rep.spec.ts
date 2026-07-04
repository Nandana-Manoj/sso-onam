import { test, expect } from '@playwright/test';
import { loadWorld, loginAs } from './helpers';

// Actual camera-based QR scanning (html5-qrcode) isn't automatable in
// Playwright without a fed video stream — this covers access control only.
// The scan/redeem RPC itself (accept, over-capacity, offline idempotency) is
// covered for real in tests/integration/sadya.test.ts. Manual QA should walk
// through an actual camera scan before release — see the coverage report.
test.describe('Sadya Rep — scan access control', () => {
  test('a resident flagged is_sadya_rep can reach /scan', async ({ page }) => {
    const world = loadWorld();
    await loginAs(page, world.users.sadyaRepMobile);
    await page.goto('/scan');
    await expect(page).toHaveURL(/\/scan$/);
  });

  test('a plain resident (not sadya-rep-flagged) reaches /scan but sees a not-authorized message, not the scanner', async ({ page }) => {
    // /scan is reachable by any authenticated role (ProtectedRoute has no
    // roles restriction here) — the is_sadya_rep/admin check happens inside
    // the page itself, not via a route redirect.
    const world = loadWorld();
    await loginAs(page, world.users.residentA[1]);
    await page.goto('/scan');
    await expect(page).toHaveURL(/\/scan$/);
    await expect(page.getByText(/not set up to scan/i)).toBeVisible();
  });

  test('an admin can reach /scan even without the is_sadya_rep flag (is_sadya_rep() includes admins)', async ({ page }) => {
    const world = loadWorld();
    await loginAs(page, world.users.adminMobile);
    await page.goto('/scan');
    await expect(page).toHaveURL(/\/scan$/);
  });
});
