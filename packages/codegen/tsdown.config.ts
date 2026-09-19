import { defineConfig, type UserConfig } from 'tsdown'

import pkg from './package.json' with { type: 'json' }

const config: UserConfig[] = defineConfig([
    {
        entry: { index: 'src/index.ts' },
        format: ['esm', 'cjs'],
        platform: 'node',
        target: 'node22',
        dts: true,
        fixedExtension: false,
        sourcemap: true,
        clean: true,
        treeshake: true,
        define: {
            __VERSION__: JSON.stringify(pkg.version),
        },
    },
    {
        // The CLI is ESM-only: it is executed, never imported, so no CJS build and no types.
        entry: { cli: 'src/cli.ts' },
        format: ['esm'],
        platform: 'node',
        target: 'node22',
        dts: false,
        fixedExtension: false,
        sourcemap: true,
        clean: false,
        treeshake: true,
        define: {
            __VERSION__: JSON.stringify(pkg.version),
        },
    },
])

export default config
