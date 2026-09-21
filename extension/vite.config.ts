import { defineConfig } from 'vite';
import { resolve } from 'path';
import fs from 'fs';
import path from 'path';

// Plugin to copy ONNX Runtime Web WASM and JS files to the dist directory
function copyOrtAssetsPlugin() {
  return {
    name: 'copy-ort-assets',
    closeBundle() {
      const ortDistPath = resolve(__dirname, '../node_modules/onnxruntime-web/dist');
      const distAssetsPath = resolve(__dirname, '../dist-extension/assets/ort');
      
      if (!fs.existsSync(distAssetsPath)) {
        fs.mkdirSync(distAssetsPath, { recursive: true });
      }

      // We need ort.all.min.js and all .wasm files
      const filesToCopy = fs.readdirSync(ortDistPath).filter(file => 
        file === 'ort.all.min.js' || file.endsWith('.wasm')
      );

      for (const file of filesToCopy) {
        fs.copyFileSync(
          path.join(ortDistPath, file),
          path.join(distAssetsPath, file)
        );
      }
      console.log('Copied ONNX Runtime Web assets to extension dist.');
    }
  };
}

function copyManifestPlugin() {
  return {
    name: 'copy-manifest',
    closeBundle() {
      const manifestPath = resolve(__dirname, 'manifest.json');
      const distManifestPath = resolve(__dirname, '../dist-extension/manifest.json');
      fs.copyFileSync(manifestPath, distManifestPath);
      console.log('Copied manifest.json to extension dist.');
    }
  };
}

export default defineConfig({
  root: __dirname,
  plugins: [copyOrtAssetsPlugin(), copyManifestPlugin()],
  build: {
    outDir: resolve(__dirname, '../dist-extension'),
    emptyOutDir: true,
    target: 'esnext',
    rollupOptions: {
      input: {
        sidepanel: resolve(__dirname, 'sidepanel.html'),
        offscreen: resolve(__dirname, 'offscreen.html'),
        service_worker: resolve(__dirname, 'service_worker.ts'),
        content: resolve(__dirname, 'content.ts'),
      },
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash].[ext]',
      },
    },
  },
  // Ensure we can resolve src/core properly
  resolve: {
    alias: {
      '@src': resolve(__dirname, '../src'),
    }
  }
});
