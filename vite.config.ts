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
      // Pre-compress public/prerendered assets at build time. Dynamic
      // server-function responses are NOT covered here — they're left for the
      // edge proxy or a follow-up runtime middleware.
      compressPublicAssets: { gzip: true, brotli: true },
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
