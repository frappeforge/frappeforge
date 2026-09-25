/**
 * Shared Vitest config for every workspace package.
 *
 * Packages call `createVitestConfig(pkg)` and pass their own additions as `overrides`, which are deep
 * merged (arrays concatenate), so a package only states what differs.
 */
import { mergeConfig, type ViteUserConfig } from 'vitest/config'

/** Builds a package's Vitest config: unit tests, type tests and 100 % per-file coverage. */
export function createVitestConfig(pkg: { version: string }, overrides: ViteUserConfig = {}): ViteUserConfig {
    const base: ViteUserConfig = {
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
                exclude: ['src/**/*.d.ts'],
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
    }
    return mergeConfig(base, overrides)
}
