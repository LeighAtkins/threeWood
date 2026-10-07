import { defineConfig } from 'vite';
import { execSync } from 'node:child_process';

// Which build this is: friends in a room must be running the same one
function buildId() {
  if (process.env.VERCEL_GIT_COMMIT_SHA) return process.env.VERCEL_GIT_COMMIT_SHA.slice(0, 7);
  try { return execSync('git rev-parse --short HEAD').toString().trim(); } catch { return 'dev'; }
}

export default defineConfig({
  define: { __BUILD__: JSON.stringify(buildId()) },
  server: {
    open: false,
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