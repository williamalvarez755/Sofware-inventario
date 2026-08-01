import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      workbox: {
        // Solo se cachea el ARMAZÓN de la app (JS/CSS/HTML). Las respuestas del
        // API jamás se cachean: un POS que muestra stock o precios viejos es
        // peor que uno que avisa "sin conexión" (D-032).
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
        navigateFallbackDenylist: [/^\/api\//],
        runtimeCaching: [],
      },
      manifest: {
        name: 'MiniMarket POS',
        short_name: 'MiniMarket',
        description: 'Punto de venta, inventario y caja para mini markets',
        lang: 'es-GT',
        theme_color: '#059669',
        background_color: '#f1f5f9',
        display: 'standalone',
        orientation: 'any',
        start_url: '/pos',
        icons: [
          { src: '/icono-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icono-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icono-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
    }),
  ],
  server: {
    port: 5173,
    proxy: {
      // En dev el front habla con el API local sin CORS.
      '/api': { target: 'http://localhost:4000', changeOrigin: true },
    },
  },
});
