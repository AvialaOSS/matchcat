import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/matchScore.test.ts'],
    environment: 'node'
  }
});
