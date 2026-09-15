import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/matchScore.test.ts', 'tests/applyAliases.test.ts', 'tests/writePreview.test.ts'],
    environment: 'node'
  }
});
