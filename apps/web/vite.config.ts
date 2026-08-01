import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      // En dev el front habla con el API local sin CORS.
      '/api': { target: 'http://localhost:4000', changeOrigin: true },
    },
  },
});
