import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    open: true, // Open browser on server start
    port: 3000, // Set a specific port
    watch: {
      // Required on Windows-mounted drives (Drvfs/9P): inotify events don't
      // fire reliably, so without polling Vite serves stale modules.
      usePolling: true,
      interval: 300,
    },
  },
  build: {
    outDir: 'dist', // Output directory for build
    sourcemap: true, // Enable source maps
  },
}); 