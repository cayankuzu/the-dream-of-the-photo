import { defineConfig } from 'vite';

export default defineConfig({
  server: { port: 4317, strictPort: true },
  build: { target: 'es2022', chunkSizeWarningLimit: 1200 },
});
