#!/usr/bin/env node
/**
 * Post-build check against the real artifacts in dist/: every `exports` target exists, and the
 * ES module loads through both `import` and `require()` (Node 22.12+), as the same instance and
 * with the package version. Runs after every build so a broken bundle never reaches `pnpm pack`.
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

const entry = path.join(pkgDir, 'dist/index.js')
const esm = await import(pathToFileURL(entry).href)
const required = createRequire(import.meta.url)(entry)

assert.equal(esm.VERSION, pkg.version, 'ESM: VERSION must equal package.json version')
// One module instance for both loaders: no dual-package hazard, so `instanceof` works everywhere.
assert.equal(required, esm, 'require(esm) must return the same module namespace as import()')

console.log(`verify-dist: ok (${pkg.name}@${pkg.version}, ESM + require(esm))`)
