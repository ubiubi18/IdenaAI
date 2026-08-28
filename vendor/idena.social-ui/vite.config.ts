import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
    base: './',
    resolve: {
        alias: {
            stream: fileURLToPath(
                new URL('./src/shims/stream.ts', import.meta.url),
            ),
        },
    },
    plugins: [react(), tailwindcss()],
    build: {
        chunkSizeWarningLimit: 1000,
    },
});
