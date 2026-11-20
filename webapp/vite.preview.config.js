import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({ plugins: [react()], base: '/preview/', build: { outDir: process.env.OUT || 'dist-preview', emptyOutDir: true, assetsInlineLimit: 0 } });
