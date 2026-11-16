import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    reporters: ['default'],
    // Las suites de integración comparten PostgreSQL y RabbitMQ y truncan las
    // mismas tablas. Ejecutar archivos en paralelo haría que una borre los
    // hechos de la otra.
    fileParallelism: false,
  },
});
