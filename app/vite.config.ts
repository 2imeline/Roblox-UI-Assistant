import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Tauri expects a fixed port in dev and relative asset paths in the bundle.
export default defineConfig({
  plugins: [react()],
  base: './',
  clearScreen: false,
  server: { port: 1420, strictPort: true, fs: { allow: ['..'] } },
  optimizeDeps: { exclude: ['@luau-rs/luau'] },
  build: { target: ['es2022', 'safari15', 'chrome100'], chunkSizeWarningLimit: 1500 },
  test: { environment: 'node', include: ['tests/**/*.test.ts'] },
});
