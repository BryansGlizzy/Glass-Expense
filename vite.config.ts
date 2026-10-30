import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import { nodePolyfills } from 'vite-plugin-node-polyfills';

export default defineConfig(() => {
  return {
    plugins: [
      react(),
      tailwindcss(),
      nodePolyfills(),
      VitePWA({
        registerType: 'autoUpdate',
        // Explicitly inject the registerSW script into the built HTML
        injectRegister: 'auto',
        includeAssets: ['icon-192.png', 'icon-512.png'],
        manifest: {
          name: 'GlassExpense',
          short_name: 'GlassExpense',
          description: 'AI-powered expense tracking with end-to-end encryption',
          theme_color: '#121317',
          background_color: '#121317',
          display: 'standalone',
          orientation: 'portrait',
          start_url: '/',
          scope: '/',
          icons: [
            // 'any' — used for browser tabs, favicons, splash screens
            {
              src: '/icon-192.png',
              sizes: '192x192',
              type: 'image/png',
              purpose: 'any',
            },
            {
              src: '/icon-512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'any',
            },
            // 'maskable' — Android adaptive icon (circle/squircle crop)
            // Requires artwork to fit within the safe zone (inner 80% of canvas)
            {
              src: '/icon-192.png',
              sizes: '192x192',
              type: 'image/png',
              purpose: 'maskable',
            },
            {
              src: '/icon-512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'maskable',
            },
          ],
        },
        workbox: {
          // Prevent SW from serving index.html for API or upload paths
          navigateFallbackDenylist: [/^\/api\//, /^\/uploads\//, /^\/vendor\//],
          // Suppress source map warnings in production
          sourcemap: false,
          // Cache the app shell and static assets (the large OCR assets are cached on first use instead)
          globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
          globIgnores: ['vendor/**'],
          maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
          runtimeCaching: [
            // Self-hosted OCR assets: cache on first use so on-device OCR keeps working offline.
            {
              urlPattern: /^\/vendor\/tesseract\//,
              handler: 'CacheFirst',
              options: {
                cacheName: 'ocr-assets',
                expiration: { maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 365 },
                cacheableResponse: { statuses: [200] },
              },
            },
            // Cache GET API calls for offline viewing. These are the encrypted /api/v2 endpoints, so what is cached is CIPHERTEXT
            // (the app decrypts it in memory). The caches are still wiped on logout / session expiry (clearLocalUserData in src/utils/sync.ts).
            {
              urlPattern: /^\/api\/v2\/(jobs|expenses|keys|blobs)$/,
              handler: 'StaleWhileRevalidate',
              options: {
                cacheName: 'api-jobs-cache',
                expiration: { maxEntries: 50, maxAgeSeconds: 60 * 60 * 24 },
                cacheableResponse: { statuses: [200] },
              },
            },
            {
              urlPattern: /^\/api\/v2\/jobs\/[^/]+\/(expenses|wishlist|subscriptions|members)$/,
              handler: 'StaleWhileRevalidate',
              options: {
                cacheName: 'api-expenses-cache',
                expiration: { maxEntries: 400, maxAgeSeconds: 60 * 60 * 24 },
                cacheableResponse: { statuses: [200] },
              },
            },
          ],
        },
        devOptions: {
          enabled: true,
        },
      }),
    ],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      allowedHosts: ['expenses.futurelabz.dev'],
    },
  };
});
