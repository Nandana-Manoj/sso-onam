// Thin client/env layer for integration tests. Reuses web/scripts/_lib.mjs
// directly (SENT sentinel constants, makeUser, cleanupTestData) rather than
// duplicating it, so the seed scripts and the test suite can never drift.
//
// Run via `npm run test:integration` (repo-root .env.staging) or
// `npm run test:integration:prod` (.env.prod-test) — both set SUPABASE_URL /
// SUPABASE_SERVICE_ROLE_KEY / SUPABASE_ANON_KEY via `node --env-file`.
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
// @ts-expect-error -- plain ESM .mjs, no type declarations
import { SENT, NOW, admin, ins, makeUser, cleanupTestData, mobileToEmail } from '../../scripts/_lib.mjs';

export { SENT, NOW, ins, makeUser, cleanupTestData, mobileToEmail };

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    throw new Error(
      `Missing ${name}. Integration tests must run via ` +
        `"node --env-file=../.env.staging node_modules/vitest/vitest.mjs run tests/integration" ` +
        `(see npm run test:integration) from the web/ directory.`,
    );
  }
  return v;
}

/** Service-role client — bypasses RLS. Use only for fixture setup/teardown, never for assertions. */
export function serviceClient(): SupabaseClient {
  return admin({ url: requireEnv('SUPABASE_URL'), key: requireEnv('SUPABASE_SERVICE_ROLE_KEY') });
}

/** Anon-key client with no session — for testing unauthenticated access denial. */
export function anonClient(): SupabaseClient {
  return createClient(requireEnv('SUPABASE_URL'), requireEnv('SUPABASE_ANON_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

const sessionCache = new Map<string, SupabaseClient>();

// Each test file's seedWorld() re-creates sentinel users with fresh auth
// UUIDs under the same mobiles — a cached session from a PRIOR file/run would
// silently point at an already-deleted user. Call this at the start of every
// seedWorld() so caching only ever spans one file's fixture lifetime.
export function clearSessionCache(): void {
  sessionCache.clear();
}

/**
 * Signs in as a seeded sentinel user and returns the session-scoped client.
 * Every request from this client is subject to real RLS as that user — this
 * is how tower isolation / cross-role denial get verified for real.
 *
 * Cached per mobile (within one vitest worker process) and retried with
 * backoff on transient rate-limit responses: the full suite signs in as the
 * same handful of sentinel users across dozens of tests, and Supabase Auth's
 * per-project sign-in rate limit is easy to trip if every test re-authenticates
 * from scratch. Mirrors the withSignupRetry pattern in src/lib/AuthContext.tsx.
 */
export async function signInAs(mobile: string): Promise<SupabaseClient> {
  const cached = sessionCache.get(mobile);
  if (cached) return cached;

  let lastError: Error | undefined;
  for (let attempt = 0; attempt < 5; attempt++) {
    const client = anonClient();
    const { error } = await client.auth.signInWithPassword({
      email: mobileToEmail(mobile),
      password: SENT.password,
    });
    if (!error) {
      sessionCache.set(mobile, client);
      return client;
    }
    lastError = new Error(`signInAs(${mobile}) failed: ${error.message}`);
    if (!/rate limit/i.test(error.message)) throw lastError;
    const delay = 800 * 2 ** attempt + Math.random() * 400;
    await new Promise((r) => setTimeout(r, delay));
  }
  throw lastError;
}
