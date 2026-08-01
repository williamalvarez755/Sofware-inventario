import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Tests de integración contra la BD dev seedeada: secuenciales para
    // evitar carreras de estado (suspensión de tenant, rotación de tokens).
    fileParallelism: false,
    testTimeout: 20000,
    env: { NODE_ENV: 'test' },
  },
});
