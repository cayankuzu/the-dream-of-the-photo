import { copyFileSync } from 'node:fs';
import { defineConfig } from 'vite';

export default defineConfig({
  server: { port: 4317, strictPort: true },
  build: { target: 'es2022', chunkSizeWarningLimit: 1500 },
  plugins: [
    {
      // the licences ask that their notices travel with the copies
      name: 'ship-notices',
      apply: 'build',
      closeBundle() {
        for (const file of ['THIRD_PARTY_NOTICES.md', 'ASSET_MANIFEST.md']) copyFileSync(file, `dist/${file}`);
      },
    },
  ],
});
