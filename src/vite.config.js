//20261110-0 add - Produce local H5 assets for the independent native host.
import { defineConfig } from 'vite';
import uniPlugin from '@dcloudio/vite-plugin-uni';
const uni = uniPlugin.default || uniPlugin;
export default defineConfig({ base: './', plugins: [uni()], build: { sourcemap: false } });
