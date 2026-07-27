import { fileURLToPath } from 'node:url'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import { defineConfig } from 'vite'

// ps2/ modules import each other with AthenaEnv's cwd-relative bare
// specifiers ('lib/input.js', 'screens/game.js', 'data/sheets.js') — the
// style QuickJS resolves on a real PS2. These aliases teach Vite the same
// resolution so one source tree serves both targets.
const ps2Dir = fileURLToPath(new URL('./ps2/', import.meta.url))

export default defineConfig(({ mode }) => {
  const isProduction = mode === 'production'

  return {
    // GitHub Pages serves this at /shmup-party-ps2/, but the build is also
    // vendored into other hosts (the cmg launcher mounts it under
    // /games/shmup-party-ps2/), so allow the mount point to be overridden.
    base: process.env.BASE_PATH || (isProduction ? '/shmup-party-ps2/' : '/'),
    // honour an assigned dev port (tooling sets PORT to run parallel servers)
    server: { port: Number(process.env.PORT) || 5173 },
    plugins: [svelte()],
    resolve: {
      dedupe: ['phaser', 'svelte'],
      alias: [
        { find: /^lib\//, replacement: `${ps2Dir}lib/` },
        { find: /^screens\//, replacement: `${ps2Dir}screens/` },
        { find: /^data\//, replacement: `${ps2Dir}data/` },
      ],
    },
    optimizeDeps: {
      // both packages ship uncompiled .svelte/.ts source
      exclude: ['5velte-ph4ser', '5velte-ps2'],
    },
    build: {
      rolldownOptions: {
        // index.html is the Xbox-green download page; play/ is the game
        input: {
          main: fileURLToPath(new URL('./index.html', import.meta.url)),
          play: fileURLToPath(new URL('./play/index.html', import.meta.url)),
        },
        output: {
          codeSplitting: {
            groups: [{ name: 'phaser', test: /node_modules[\\/]phaser/ }],
          },
        },
      },
    },
  }
})
