import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Default environment is jsdom for unit/component tests. Integration tests
// (tests/integration/**) opt into node + real network via a
// `// @vitest-environment node` pragma at the top of each file — they hit a
// live Supabase project (staging by default), not a mock.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.test.{ts,tsx}'],
    // Integration tests share one live sentinel-tagged dataset (seed/cleanup
    // per file) — running files in parallel would let them clobber each
    // other's fixtures. Unit/component tests are cheap enough that running
    // files sequentially costs nothing noticeable.
    fileParallelism: false,
    env: {
      // Placeholder values so importing src/lib/supabase.ts never throws in
      // unit/component tests — those tests mock the module and never hit
      // the network. Integration tests get real values from --env-file.
      VITE_SUPABASE_URL: 'http://localhost:54321',
      VITE_SUPABASE_ANON_KEY: 'test-anon-key',
    },
  },
});
