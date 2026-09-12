import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: {
    // Dentro de Docker hay que escuchar en todas las interfaces para que
    // el puerto publicado (5173) llegue al contenedor.
    host: true,
    port: 5173,
    strictPort: true,
  },
});
