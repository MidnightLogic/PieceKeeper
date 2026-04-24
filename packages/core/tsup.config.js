import { defineConfig } from 'tsup';

export default defineConfig({
    entry: ['src/index.js'],
    format: ['esm', 'cjs'],
    splitting: false,
    clean: true,
    dts: true,
    sourcemap: true,
    target: 'node18',
    external: [],
    noExternal: ['hash-wasm'],
});
