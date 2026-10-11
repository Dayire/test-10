import { defineConfig } from 'vite';
import { fileURLToPath } from 'url';
import path from 'path';

// The artifact build (the host's sandboxed frame): one module with every chapter inlined, fonts as data URIs,
// and import.meta.env.VITE_ARTIFACT, which strips the dev views, the GLB fetch, the service worker and reloads.
// tools/make-artifact.mjs then folds index.html, the CSS and the JS into one medina.html.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export default defineConfig({
  root,
  base: './',
  logLevel: 'warn',
  define: { 'import.meta.env.VITE_ARTIFACT': JSON.stringify('1') },
  build: {
    target: 'es2022',
    outDir: path.join(root, 'dist-artifact'),
    emptyOutDir: true,
    assetsInlineLimit: 1 << 22,
    cssCodeSplit: false,
    modulePreload: false,
    chunkSizeWarningLimit: 4000,
    rollupOptions: {
      output: { entryFileNames: 'game.js', codeSplitting: false, assetFileNames: '[name][extname]' },
    },
  },
});
