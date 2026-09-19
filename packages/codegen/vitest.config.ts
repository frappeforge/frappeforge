import { defineConfig, type ViteUserConfig } from 'vitest/config'

import pkg from './package.json' with { type: 'json' }

const config: ViteUserConfig = defineConfig({
    define: {
        __VERSION__: JSON.stringify(pkg.version),
    },
    test: {
        environment: 'node',
        include: ['tests/**/*.test.ts'],
        // Type-level tests (`expectTypeOf`) run through tsc alongside the runtime suite.
        typecheck: {
            enabled: true,
            include: ['tests/**/*.test-d.ts'],
        },
        coverage: {
            provider: 'v8',
            include: ['src/**/*.ts'],
            // The CLI entry is exercised end-to-end against dist/ by scripts/verify-dist.mjs.
            exclude: ['src/**/*.d.ts', 'src/cli.ts'],
            reporter: ['text', 'lcov'],
            thresholds: {
                lines: 100,
                functions: 100,
                statements: 100,
                branches: 100,
                perFile: true,
            },
        },
    },
})

export default config
