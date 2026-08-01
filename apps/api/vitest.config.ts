import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Tests de integración contra la BD dev seedeada: secuenciales para
    // evitar carreras de estado (suspensión de tenant, rotación de tokens).
    fileParallelism: false,
    testTimeout: 20000,
    // Los límites de autenticación se elevan aquí: las suites hacen decenas de
    // inicios de sesión y no deben chocar con una defensa calibrada para
    // humanos. Su lógica se prueba por unidad en tests/rate-limit.test.ts.
    env: { NODE_ENV: 'test', RATE_LIMIT_MULTIPLIER: '100' },
  },
});
