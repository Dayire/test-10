import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: {
    target: 'es2022',
    outDir: 'dist',
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 2000,
    rollupOptions: {
      output: {
        entryFileNames: 'game.js',
        chunkFileNames: 'chunk-[name].js',
        assetFileNames: '[name][extname]',
      },
    },
  },
  server: { host: '127.0.0.1', watch: { ignored: ['**/shots/**', '**/tools/**', '**/docs/**', '**/dist/**'] } },
});
