import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    // During development the API runs under `wrangler pages dev` on port 8788.
    proxy: { '/api': 'http://127.0.0.1:8788' },
  },
});
