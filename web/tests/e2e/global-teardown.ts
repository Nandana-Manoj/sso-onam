import { serviceClient } from '../fixtures/testEnv';
import { teardownWorld } from '../fixtures/world';

export default async function globalTeardown() {
  const db = serviceClient();
  await teardownWorld(db);
}
