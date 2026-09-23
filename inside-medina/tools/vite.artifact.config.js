import { defineConfig } from 'vite';
import { fileURLToPath } from 'url';
import path from 'path';

// Single-file module build for publishing the game as a web artifact.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export default defineConfig({
  root,
  base: './',
  logLevel: 'warn',
  build: {
    target: 'es2022',
    outDir: path.join(root, 'dist-artifact'),
    emptyOutDir: true,
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 4000,
    rollupOptions: {
      output: { entryFileNames: 'game.js', codeSplitting: false, assetFileNames: '[name][extname]' },
    },
  },
});
