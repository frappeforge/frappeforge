#!/usr/bin/env node
/**
 * Post-build check against the real artifacts in dist/: every `exports` target exists, and
 * both module formats load and agree on the package version. Runs after every build so a
 * broken bundle never reaches `pnpm pack`.
 */
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const pkgDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(readFileSync(path.join(pkgDir, 'package.json'), 'utf8'))

function* exportTargets(value) {
    if (typeof value === 'string') {
        yield value
    } else if (value && typeof value === 'object') {
        for (const inner of Object.values(value)) yield* exportTargets(inner)
    }
}

for (const target of exportTargets(pkg.exports)) {
    assert.ok(existsSync(path.join(pkgDir, target)), `exports target is missing after build: ${target}`)
}

const esm = await import(pathToFileURL(path.join(pkgDir, 'dist/index.js')).href)
const cjs = createRequire(import.meta.url)(path.join(pkgDir, 'dist/index.cjs'))

assert.equal(esm.VERSION, pkg.version, 'ESM: VERSION must equal package.json version')
assert.equal(cjs.VERSION, pkg.version, 'CJS: VERSION must equal package.json version')

console.log(`verify-dist: ok (${pkg.name}@${pkg.version}, ESM + CJS)`)
