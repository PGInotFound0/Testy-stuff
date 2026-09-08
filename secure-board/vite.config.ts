import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  build: {
    chunkSizeWarningLimit: 1_200,
  },
  test: {
    environment: 'jsdom',
    environmentOptions: {
      jsdom: { url: 'https://secure-board.test/' },
    },
    setupFiles: './tests/setup.ts',
    restoreMocks: true,
  },
});
