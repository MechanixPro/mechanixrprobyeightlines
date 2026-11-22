import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
// The hidden /preview/ app (app-style v3). Multi-file bundle (CSP script-src 'self'). v3.html is renamed to index.html after the build.
export default defineConfig({ plugins: [react()], base: '/preview/', build: { outDir: process.env.OUT || 'dist-preview', emptyOutDir: true, assetsInlineLimit: 0, rollupOptions: { input: 'v3.html' } } });
