/**
 * Shared tsdown config for every workspace package.
 *
 * Packages call `createTsdownConfig(pkg)` and pass what differs as `overrides` (shallow merge).
 */
import type { UserConfig } from 'tsdown'

/** The fields of a package's `package.json` the build needs. */
export interface BuildPackage {
    version: string
    description: string
}

/**
 * Builds a package's tsdown config.
 *
 * The package description becomes the `@packageDocumentation` block at the top of the bundled `.d.ts`,
 * so API Extractor and editors see it. A doc comment in `src/index.ts` would not survive bundling: it is
 * attached to an `export *` statement that the declaration bundler removes.
 */
export function createTsdownConfig(pkg: BuildPackage, overrides: UserConfig = {}): UserConfig {
    return {
        entry: { index: 'src/index.ts' },
        format: ['esm', 'cjs'],
        // Runs anywhere `fetch` runs: Node, browsers, workers, edge. Never assume a runtime.
        platform: 'neutral',
        target: 'es2022',
        dts: true,
        // `.js` (ESM) + `.cjs` (CJS) inside a `type: module` package. Explicit because tsdown flips this
        // default per platform, and the `exports` maps depend on these exact names.
        fixedExtension: false,
        sourcemap: true,
        clean: true,
        treeshake: true,
        define: {
            __VERSION__: JSON.stringify(pkg.version),
        },
        banner: {
            dts: `/**\n * ${pkg.description}\n *\n * @packageDocumentation\n */`,
        },
        ...overrides,
    }
}
