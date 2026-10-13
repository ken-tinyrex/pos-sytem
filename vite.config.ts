import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import basicSsl from '@vitejs/plugin-basic-ssl'

// HTTPS=1 serves over HTTPS with a self-signed certificate. Phones on the local network
// need HTTPS for the camera scanner and the offline service worker.
const https = process.env.HTTPS === '1'

export default defineConfig({
  // Listen on all interfaces so other devices on the same Wi-Fi can open the app.
  server: { host: true },
  preview: { host: true },
  plugins: [
    ...(https ? [basicSsl()] : []),
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg', 'icon-180.png'],
      manifest: {
        name: 'Kiko Store POS',
        short_name: 'Kiko Store POS',
        description: 'Offline point-of-sale for small grocery stores',
        theme_color: '#059669',
        background_color: '#ffffff',
        display: 'standalone',
        orientation: 'any',
        start_url: '/',
        icons: [
          { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any maskable' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2,wasm}'],
        maximumFileSizeToCacheInBytes: 3 * 1024 * 1024, // ZXing barcode WASM is ~1 MB
        navigateFallback: '/index.html',
      },
    }),
  ],
})
