import basicSsl from '@vitejs/plugin-basic-ssl';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

/**
 * Modo "movil": sirve el dev server por HTTPS con certificado propio para
 * probar desde un teléfono de la misma red. No es un capricho de seguridad —
 * la cámara (`getUserMedia`) solo existe en contexto seguro, así que sobre
 * http:// el escáner por cámara simplemente no aparece. El certificado es
 * autofirmado: el teléfono avisa una vez y se acepta.
 *
 * No afecta al build ni al dev normal en localhost (`server` solo vive en dev,
 * y el HTTPS se activa únicamente con `npm run dev:movil`).
 */
export default defineConfig(({ mode }) => ({
  plugins: [
    react(),
    tailwindcss(),
    ...(mode === 'movil' ? [basicSsl()] : []),
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
    // Solo en modo movil se escucha en todas las interfaces: el dev de todos
    // los días sigue atado a localhost, sin exponer nada a la red.
    host: mode === 'movil',
    proxy: {
      // En dev el front habla con el API local sin CORS. El teléfono también
      // pasa por aquí, así que no hay que exponer el API por separado.
      '/api': { target: 'http://localhost:4000', changeOrigin: true },
    },
  },
}));
