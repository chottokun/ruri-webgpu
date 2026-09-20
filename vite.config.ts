import { defineConfig } from 'vite';

export default defineConfig({
  base: '/ruri-webgpu/',
  server: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
  preview: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
  optimizeDeps: {
    exclude: ['onnxruntime-web'],
  },
  build: {
    target: 'esnext',
    rollupOptions: {
      external: ['onnxruntime-web'],
      output: {
        globals: {
          'onnxruntime-web': 'ort',
        },
      },
    },
  },
});
