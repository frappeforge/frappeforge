import { defineConfig, type UserConfig } from 'tsdown'

import pkg from './package.json' with { type: 'json' }

const config: UserConfig = defineConfig({
    entry: { index: 'src/index.ts' },
    format: ['esm', 'cjs'],
    // Runs anywhere `fetch` runs: Node, browsers, workers, edge. Never assume a runtime.
    platform: 'neutral',
    target: 'es2022',
    dts: true,
    // `.js` (ESM) + `.cjs` (CJS) inside a `type: module` package. Explicit because tsdown
    // flips this default per platform, and the `exports` map depends on these exact names.
    fixedExtension: false,
    sourcemap: true,
    clean: true,
    treeshake: true,
    define: {
        __VERSION__: JSON.stringify(pkg.version),
    },
})

export default config
