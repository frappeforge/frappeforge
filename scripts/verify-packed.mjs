#!/usr/bin/env node
/**
 * Installs every workspace package from its packed tarball into throwaway consumers and
 * verifies what a real user gets: an ESM consumer, a CommonJS consumer, the CLI binaries,
 * and the published type declarations under `moduleResolution: NodeNext`.
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

    // CommonJS consumer: the `require` condition must resolve and agree.
    writeFileSync(
        join(fixture, 'cjs.cjs'),
        packages
            .map(
                (pkg, i) =>
                    `const { VERSION: v${i} } = require('${pkg.name}')\n` +
                    `if (v${i} !== '${pkg.version}') throw new Error('CJS: ${pkg.name} VERSION is ' + v${i})\n`,
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

    // Type declarations: a strict NodeNext consumer compiles against the packed .d.ts / .d.cts.
    writeFileSync(
        join(fixture, 'consumer.mts'),
        packages.map((pkg, i) => `import { VERSION as v${i} } from '${pkg.name}'\nv${i} satisfies string\n`).join(''),
    )
    writeFileSync(
        join(fixture, 'consumer.cts'),
        packages.map((pkg, i) => `import { VERSION as v${i} } from '${pkg.name}'\nv${i} satisfies string\n`).join(''),
    )
    writeFileSync(
        join(fixture, 'tsconfig.json'),
        JSON.stringify({
            compilerOptions: {
                module: 'NodeNext',
                moduleResolution: 'NodeNext',
                target: 'ES2022',
                strict: true,
                noEmit: true,
                skipLibCheck: false,
                types: [],
            },
            include: ['consumer.mts', 'consumer.cts'],
        }),
    )
    run(node, [join(root, 'node_modules', 'typescript', 'bin', 'tsc'), '-p', 'tsconfig.json'])

    console.log(`verify-packed: ok (${packages.map((p) => p.name).join(', ')} — ESM, CJS, CLI, NodeNext types)`)
} finally {
    rmSync(fixture, { recursive: true, force: true })
}
