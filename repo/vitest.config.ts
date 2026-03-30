import { fileURLToPath, URL } from 'node:url';
import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url))
    }
  },
  test: {
    include: ['unit_tests/**/*.test.ts', 'API_tests/**/*.test.ts'],
    environment: 'node',
    clearMocks: true,
    restoreMocks: true
  }
});
