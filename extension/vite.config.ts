import { defineConfig } from 'vite';
import { resolve } from 'path';
import fs from 'fs';
import path from 'path';

function copyOrtAssetsPlugin() {
  return {
    name: 'copy-ort-assets',
    closeBundle() {
      const ortDistPath = resolve(__dirname, '../node_modules/onnxruntime-web/dist');
      const distAssetsPath = resolve(__dirname, '../dist-extension/assets/ort');
      
      if (!fs.existsSync(distAssetsPath)) {
        fs.mkdirSync(distAssetsPath, { recursive: true });
      }

      const filesToCopy = fs.readdirSync(ortDistPath).filter(file => 
        file === 'ort.all.min.js' || file.endsWith('.wasm') || file.endsWith('.mjs')
      );

      for (const file of filesToCopy) {
        const srcFile = path.join(ortDistPath, file);
        const destFile = path.join(distAssetsPath, file);

        if (file === 'ort.all.min.js') {
          let content = fs.readFileSync(srcFile, 'utf-8');
          // Chrome MV3動的import回避: globalThis.__ortWasmThreaded が存在する場合は動的importをバイパス
          const target = 'q1=async r=>(await import(/*webpackIgnore:true*/ /*@vite-ignore*/r)).default';
          const replacement = 'q1=async r=>globalThis.__ortWasmThreaded||(await import(/*webpackIgnore:true*/ /*@vite-ignore*/r)).default';
          if (content.includes(target)) {
            content = content.replace(target, replacement);
            console.log('Successfully patched ort.all.min.js to bypass dynamic import.');
          } else {
            console.warn('Target string not found in ort.all.min.js for patching!');
          }
          fs.writeFileSync(destFile, content, 'utf-8');
        } else {
          fs.copyFileSync(srcFile, destFile);
        }
      }
      console.log('Copied and configured ONNX Runtime Web assets to extension dist.');
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
  base: './',
  root: __dirname,
  plugins: [copyOrtAssetsPlugin(), copyManifestPlugin()],
  build: {
    outDir: resolve(__dirname, '../dist-extension'),
    emptyOutDir: true,
    target: 'esnext',
    rollupOptions: {
      input: {
        offscreen: resolve(__dirname, 'offscreen.html'),
        service_worker: resolve(__dirname, 'service_worker.ts'),
        content: resolve(__dirname, 'content.ts'),
        overlay: resolve(__dirname, 'overlay.css'),
      },
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name].[ext]',
      },
    },
  },
  resolve: {
    alias: {
      '@src': resolve(__dirname, '../src'),
    }
  }
});
