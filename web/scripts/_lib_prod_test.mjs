// Extra safeguards for the (opt-in, final-pass-only) prod-test scripts.
// Deliberately separate from _lib.mjs's loadEnv()/confirmTarget(), which are
// built to REFUSE prod — this is the inverse: explicit, multi-flag opt-IN so
// a copy-paste slip or muscle memory can never fire this against prod by
// accident. See docs on the plan for why prod testing is opt-in-only.
import { SENT, NOW, admin, ins, makeUser, cleanupTestData, fail } from './_lib.mjs';

export { SENT, NOW, admin, ins, makeUser, cleanupTestData, fail };

export function loadProdTestEnv() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const expected = process.env.EXPECTED_PROD_URL;
  if (!url || !key) {
    fail(
      'Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.\n' +
        'Copy .env.prod-test.example → .env.prod-test (repo root) and fill in the PROD project\'s\n' +
        'URL + service_role key, then run from the repo root with:\n' +
        '  node --env-file=.env.prod-test web/scripts/<script>.mjs --yes-this-is-prod',
    );
  }
  if (!expected) {
    fail('Missing EXPECTED_PROD_URL in .env.prod-test — set it to the exact prod project URL as an explicit opt-in guard.');
  }
  return { url, key, expected };
}

const norm = (u) => String(u || '').trim().replace(/\/+$/, '').toLowerCase();

// Three independent confirmations, all required: the target URL must exactly
// match a value you deliberately typed into .env.prod-test, an explicit
// "I understand" env var, AND a distinct (--yes-this-is-prod, not --yes) CLI
// flag — so this can never fire via the same muscle memory as the staging
// scripts.
export function confirmProdTarget({ url, expected }, action) {
  const host = (() => {
    try { return new URL(url).host; } catch { return url; }
  })();

  console.log('\n  ⚠️  TARGET IS PRODUCTION — this writes real data to the live project.  ⚠️');
  console.log(`  Target Supabase project : ${host}`);
  console.log(`  Action                  : ${action}\n`);

  if (norm(url) !== norm(expected)) {
    fail('Refusing to run: SUPABASE_URL does not exactly match EXPECTED_PROD_URL in .env.prod-test.');
  }
  if (process.env.I_UNDERSTAND_THIS_IS_PRODUCTION !== 'true') {
    fail('Refusing to run: set I_UNDERSTAND_THIS_IS_PRODUCTION=true in .env.prod-test.');
  }
  if (!process.argv.includes('--yes-this-is-prod')) {
    fail('Refusing to run without confirmation. Re-run with --yes-this-is-prod once the target above is correct.');
  }
}
