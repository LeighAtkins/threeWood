import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    open: true, // Open browser on server start
    port: 3000, // Set a specific port
  },
  build: {
    outDir: 'dist', // Output directory for build
    sourcemap: true, // Enable source maps
  },
}); 