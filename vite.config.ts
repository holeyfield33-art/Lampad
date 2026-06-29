import preact from '@preact/preset-vite';
import tailwindcss from '@tailwindcss/vite';
import path from 'path';
import {defineConfig} from 'vite';
import {VitePWA} from 'vite-plugin-pwa';

export default defineConfig(() => {
  return {
    plugins: [
      preact(),
      tailwindcss(),
      VitePWA({
        registerType: 'autoUpdate',
        workbox: {
          maximumFileSizeToCacheInBytes: 524288000, // 500MB
          globPatterns: ['**/*.{js,css,html,ico,png,svg,wasm}']
        },
        manifest: {
          name: 'Lampad AtlasBridge',
          short_name: 'AtlasBridge',
          description: 'Offline-first newcomer assistant with on-device LLM & vector search.',
          theme_color: '#0f172a',
          background_color: '#0f172a',
          display: 'standalone',
          icons: [
            {
              src: 'pwa-192x192.png',
              sizes: '192x192',
              type: 'image/png'
            },
            {
              src: 'pwa-512x512.png',
              sizes: '512x512',
              type: 'image/png'
            }
          ]
        }
      })
    ],
    worker: {
      format: 'es' as const,
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
        'react': 'preact/compat',
        'react-dom/test-utils': 'preact/compat/test-utils',
        'react-dom': 'preact/compat',
        'react/jsx-runtime': 'preact/compat/jsx-runtime',
      },
    },
    server: {
      hmr: process.env.DISABLE_HMR !== 'true',
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
