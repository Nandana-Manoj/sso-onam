// Reset STAGING by removing the seeded dataset (sentinel-tagged rows only).
//
//   node --env-file=.env.staging web/scripts/reset-staging.mjs --yes
//
// This deletes ONLY rows the seed created (test towers TTA/TTB/TTC, the year-9999
// test event and its children, and accounts in the +919999000… range). It does
// NOT touch accounts a tester self-registered or any other data. To get a clean
// known-good state again, run seed-staging.mjs afterwards (the seed also cleans
// first, so "reset then seed" and "just seed" are equivalent). See §4 of
// docs/release-readiness.md.

import { loadEnv, confirmTarget, admin, cleanupTestData } from './_lib.mjs';

const env = loadEnv();
confirmTarget(env, 'RESET staging (delete seeded test data)');
const db = admin(env);

const counts = await cleanupTestData(db);
console.log('\n✔ Reset complete. Removed:');
for (const [k, v] of Object.entries(counts)) console.log(`    ${k}: ${v}`);
console.log('\nRun seed-staging.mjs to repopulate a fresh dataset.\n');
