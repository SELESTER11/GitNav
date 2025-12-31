import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';
import { copyFileSync, mkdirSync, readdirSync, existsSync } from 'fs';

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'copy-files',
      closeBundle() {
        // Copy manifest
        copyFileSync('manifest.json', 'dist/manifest.json');
        
        // Create dist/icons directory
        mkdirSync('dist/icons', { recursive: true });
        
        // Copy all icon files
        const iconFiles = readdirSync('icons');
        iconFiles.forEach(file => {
          if (file.endsWith('.png') || file.endsWith('.svg')) {
            copyFileSync(`icons/${file}`, `dist/icons/${file}`);
          }
        });
        
        console.log('Copied icons to dist/icons/');
      }
    }
  ],
  build: {
    rollupOptions: {
      input: {
        popup: resolve(__dirname, 'public/index.html'),
        content: resolve(__dirname, 'src/content.js'),
        background: resolve(__dirname, 'src/background.js')
      },
      output: {
        entryFileNames: 'src/[name].js',
        chunkFileNames: 'src/[name].js',
        assetFileNames: 'src/[name].[ext]'
      }
    },
    minify: false,
    outDir: 'dist'
  }
});