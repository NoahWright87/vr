import { cp, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const root = import.meta.dirname;
const output = resolve(root, 'dist');

async function copyDirectory(source, destination) {
  await mkdir(destination, { recursive: true });
  await cp(source, destination, { recursive: true });
}

function copyRuntimeAssets() {
  return {
    name: 'copy-runtime-assets',
    apply: 'build',
    async closeBundle() {
      await Promise.all([
        copyDirectory(resolve(root, 'vendor'), resolve(output, 'vendor')),
        copyDirectory(
          resolve(root, 'games/pistols-at-dawn/js'),
          resolve(output, 'games/pistols-at-dawn/js'),
        ),
        copyDirectory(
          resolve(root, 'games/pistols-at-dawn/assets'),
          resolve(output, 'games/pistols-at-dawn/assets'),
        ),
      ]);
    },
  };
}

export default defineConfig({
  plugins: [react(), copyRuntimeAssets()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rolldownOptions: {
      input: {
        home: resolve(root, 'index.html'),
        about: resolve(root, 'about/index.html'),
        cubePop: resolve(root, 'games/cube-pop/index.html'),
        punchPop: resolve(root, 'games/punch-pop/index.html'),
        pistolsAtDawn: resolve(root, 'games/pistols-at-dawn/index.html'),
        menuShowcase: resolve(root, 'primitives/menus/index.html'),
      },
    },
  },
});
