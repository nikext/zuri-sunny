import { defineConfig } from 'vitest/config'
import { devtools } from '@tanstack/devtools-vite'

import { tanstackStart } from '@tanstack/react-start/plugin/vite'

import viteReact from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { nitro } from 'nitro/vite'

const config = defineConfig({
  resolve: { tsconfigPaths: true },
  plugins: [
    devtools(),
    nitro({
      rollupConfig: { external: [/^@sentry\//] },
      // Pre-compress public/prerendered static assets at build time.
      compressPublicAssets: { gzip: true, brotli: true },
      // Runtime gzip/brotli for dynamic responses (SSR HTML, server-function
      // JSON). Railway's edge does not compress these.
      plugins: ['./src/server/plugins/compression.ts'],
    }),
    tailwindcss(),
    tanstackStart(),
    viteReact(),
  ],
  test: {
    env: { TZ: 'UTC' },
  },
})

export default config
