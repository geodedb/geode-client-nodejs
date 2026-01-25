import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/bench/**/*.bench.ts'],
    benchmark: {
      include: ['tests/bench/**/*.bench.ts'],
      reporters: ['default'],
      outputJson: './benchmark-results.json',
    },
  },
});
