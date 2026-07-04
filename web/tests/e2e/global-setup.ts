import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { serviceClient } from '../fixtures/testEnv';
import { seedWorld } from '../fixtures/world';

// Runs once before the whole E2E run, in the same Node process the
// `node --env-file=...` flag applies to (see npm run test:e2e[:prod]), so
// SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are already in process.env here.
// The browser-driven webServer (Vite) is a separate process that loads its
// own VITE_-prefixed env from web/.env.staging or web/.env.prod-test.
export default async function globalSetup() {
  const db = serviceClient();
  const world = await seedWorld(db);
  await writeFile(path.join(import.meta.dirname, '.world.json'), JSON.stringify(world, null, 2));
}
