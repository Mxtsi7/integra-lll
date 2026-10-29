import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  // Compatibilidad jsdom ↔ `Request` de Node en las navegaciones de React
  // Router. Ver src/test/entorno.ts.
  test: {
    setupFiles: ['./src/test/entorno.ts'],
  },
  server: {
    // Dentro de Docker hay que escuchar en todas las interfaces para que
    // el puerto publicado (5173) llegue al contenedor.
    host: true,
    port: 5173,
    strictPort: true,
  },
});
