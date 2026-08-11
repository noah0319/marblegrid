import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        '@shared': resolve('src/shared')
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        '@shared': resolve('src/shared')
      }
    }
  },
  renderer: {
    root: 'src/renderer',
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src'),
        '@shared': resolve('src/shared')
      }
    },
    plugins: [react()],
    build: {
      rollupOptions: {
        // HTML entries in the same renderer root (simpler and more
        // reliable with Vite's dev/build tooling than a separate top-level
        // overlay/ folder outside this root, which the original plan
        // sketched — see the Phase 4 iteration log for why this changed).
        // The overlay is two entries, not one: split per Noah's request so
        // the result toast and the leaderboard ticker are independent OBS
        // Browser Sources he can position separately, instead of one
        // combined page with both stuck at fixed relative positions.
        input: {
          index: resolve('src/renderer/index.html'),
          'overlay-toast': resolve('src/renderer/overlay-toast.html'),
          'overlay-leaderboard': resolve('src/renderer/overlay-leaderboard.html')
        }
      }
    }
  }
})
