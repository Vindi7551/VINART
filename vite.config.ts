import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    exclude: ['playwright', 'playwright-core'],
  },
  build: {
    rollupOptions: {
      external: ['playwright', 'playwright-core'],
    },
  },
});
