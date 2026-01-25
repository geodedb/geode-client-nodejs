import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/property/**/*.property.ts'],
    testTimeout: 30000, // Property tests may take longer
  },
});
