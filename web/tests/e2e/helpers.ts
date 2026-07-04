import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import type { World } from '../fixtures/world';
import { SENT } from '../fixtures/testEnv';

export { SENT };

export function loadWorld(): World {
  const raw = readFileSync(path.join(import.meta.dirname, '.world.json'), 'utf-8');
  return JSON.parse(raw) as World;
}

export async function loginAs(page: Page, mobile: string, password = SENT.password) {
  await page.goto('/login');
  await page.getByLabel(/mobile number/i).fill(mobile);
  await page.getByLabel(/^password$/i).fill(password);
  await page.getByRole('button', { name: /log in/i }).click();
  // signIn() + the client-side nav('/') both resolve asynchronously — without
  // waiting here, a test's next page.goto() can race ahead of the session
  // actually being established and get bounced back to /login by ProtectedRoute.
  // Swallowed if it never navigates (e.g. a deliberately wrong password) —
  // the calling test's own assertions decide pass/fail in that case.
  await page.waitForURL((url) => !url.pathname.endsWith('/login'), { timeout: 5_000 }).catch(() => {});
}
