#!/usr/bin/env node
/**
 * Installs every workspace package from its packed tarball into throwaway consumers and
 * verifies what a real user gets: an ESM consumer, a CommonJS consumer (`require(esm)`, Node
 * 22.12+), the CLI binaries, and the published type declarations under `NodeNext` (ESM and CJS
 * files) and under `moduleResolution: bundler` (Vite, webpack, esbuild).
 *
 * Nothing here uses the workspace's own node_modules for the packages under test — only
 * the tarballs — so a missing `files` entry or a wrong `exports` target fails here, not in
 * production. Run through pnpm: `pnpm verify:packed`.
 */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const packagesDir = join(root, 'packages')
const fixture = mkdtempSync(join(tmpdir(), 'frappeforge-packed-'))
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const node = process.execPath
const pnpmScript = process.env['npm_execpath']

assert.ok(pnpmScript, 'verify-packed must be run through pnpm (`pnpm verify:packed`)')
// pnpm is either a JS entry point (run it with node) or a native binary.
const [pnpmBin, ...pnpmArgs] = /\.[cm]?js$/.test(pnpmScript) ? [node, pnpmScript] : [pnpmScript]

/**
 * Runs a command and returns its stdout.
 * @param {string} file
 * @param {string[]} args
 * @param {string} [cwd]
 */
function run(file, args, cwd = fixture) {
    return execFileSync(file, args, {
        cwd,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: process.platform === 'win32',
    })
}

const packages = readdirSync(packagesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
        const dir = join(packagesDir, entry.name)
        const manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
        return { dir, name: manifest.name, version: manifest.version, bin: manifest.bin ?? {} }
    })

assert.ok(packages.length > 0, 'no packages found under packages/')

try {
    for (const pkg of packages) {
        run(pnpmBin, [...pnpmArgs, '--dir', pkg.dir, 'pack', '--pack-destination', fixture])
    }
    const tarballs = readdirSync(fixture)
        .filter((name) => name.endsWith('.tgz'))
        .map((name) => join(fixture, name))
    assert.equal(tarballs.length, packages.length, `expected ${packages.length} tarballs, found ${tarballs.length}`)

    writeFileSync(join(fixture, 'package.json'), JSON.stringify({ private: true, type: 'module' }))
    run(npm, ['install', '--ignore-scripts', '--no-package-lock', '--no-audit', '--no-fund', ...tarballs])

    // ESM consumer: every package resolves through `exports` and reports its own version.
    writeFileSync(
        join(fixture, 'esm.mjs'),
        packages
            .map(
                (pkg, i) =>
                    `import { VERSION as v${i} } from '${pkg.name}'\n` +
                    `if (v${i} !== '${pkg.version}') throw new Error('ESM: ${pkg.name} VERSION is ' + v${i})\n`,
            )
            .join(''),
    )
    run(node, ['esm.mjs'])

    // CommonJS consumer: `require()` loads the ES module, and `import()` returns the same instance —
    // one copy of every class per process. A rejected check exits non-zero as an unhandled rejection.
    writeFileSync(
        join(fixture, 'cjs.cjs'),
        packages
            .map(
                (pkg, i) =>
                    `const v${i} = require('${pkg.name}')\n` +
                    `if (v${i}.VERSION !== '${pkg.version}') throw new Error('CJS: ${pkg.name} VERSION is ' + v${i}.VERSION)\n` +
                    `import('${pkg.name}').then((m) => { if (m !== v${i}) throw new Error('CJS: ${pkg.name} loaded twice') })\n`,
            )
            .join(''),
    )
    run(node, ['cjs.cjs'])

    // CLI binaries: installed under node_modules/.bin and runnable.
    for (const pkg of packages) {
        for (const binName of Object.keys(pkg.bin)) {
            const out = run(node, [join(fixture, 'node_modules', pkg.name, pkg.bin[binName]), '--version']).trim()
            assert.equal(out, pkg.version, `${binName} --version printed ${out}`)
        }
    }

    // Type declarations: strict consumers compile against the packed .d.ts. NodeNext covers an ESM and
    // a CommonJS file (TypeScript 5.8+ types `require(esm)`); bundler is what Vite, webpack and esbuild
    // users get. Without declarations in the tarball, all three fail with TS7016.
    const consumer = packages
        .map((pkg, i) => `import { VERSION as v${i} } from '${pkg.name}'\nv${i} satisfies string\n`)
        .join('')
    const compilerOptions = { target: 'ES2022', strict: true, noEmit: true, skipLibCheck: false, types: [] }
    const tsc = join(root, 'node_modules', 'typescript', 'bin', 'tsc')
    for (const file of ['consumer.mts', 'consumer.cts', 'consumer.bundler.ts']) {
        writeFileSync(join(fixture, file), consumer)
    }
    writeFileSync(
        join(fixture, 'tsconfig.json'),
        JSON.stringify({
            compilerOptions: { ...compilerOptions, module: 'NodeNext', moduleResolution: 'NodeNext' },
            include: ['consumer.mts', 'consumer.cts'],
        }),
    )
    writeFileSync(
        join(fixture, 'tsconfig.bundler.json'),
        JSON.stringify({
            compilerOptions: { ...compilerOptions, module: 'ESNext', moduleResolution: 'bundler' },
            include: ['consumer.bundler.ts'],
        }),
    )
    run(node, [tsc, '-p', 'tsconfig.json'])
    run(node, [tsc, '-p', 'tsconfig.bundler.json'])

    console.log(
        `verify-packed: ok (${packages.map((p) => p.name).join(', ')} — ESM, require(esm), CLI, NodeNext + bundler types)`,
    )
} finally {
    rmSync(fixture, { recursive: true, force: true })
}
