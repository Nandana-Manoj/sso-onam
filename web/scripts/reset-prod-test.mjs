// Remove the sentinel-tagged prod-test dataset from PRODUCTION. Same
// cleanupTestData() as reset-staging.mjs (deletes ONLY rows tagged with the
// SENT sentinels — test towers, the year-9999 event, +919999000… accounts).
// Always run this immediately after a prod-test validation pass.
//
//   node --env-file=.env.prod-test web/scripts/reset-prod-test.mjs --yes-this-is-prod

import { loadProdTestEnv, confirmProdTarget, admin, cleanupTestData } from './_lib_prod_test.mjs';

const env = loadProdTestEnv();
confirmProdTarget(env, 'RESET PRODUCTION (delete sentinel-tagged prod-test data)');
const db = admin(env);

const counts = await cleanupTestData(db);
console.log('\n✔ Prod-test reset complete. Removed:');
for (const [k, v] of Object.entries(counts)) console.log(`    ${k}: ${v}`);
console.log('\nProduction is clean of sentinel test data.\n');
