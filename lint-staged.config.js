import path from 'node:path'

/** A path under `packages/<name>/`, captured up to the package directory. */
const PACKAGE = /^packages\/[^/]+(?=\/)/

/** @param {string} file */
function quote(file) {
    return `'${file.replaceAll("'", "'\\''")}'`
}

/**
 * Lints staged files with the ESLint config that owns them: each package's own config for files inside
 * `packages/<name>/`, the root config for everything else. New packages need no change here.
 *
 * @param {string[]} files Absolute paths of the staged files.
 * @returns {string[]} One command per config.
 */
function eslint(files) {
    /** @type {Map<string, string[]>} */
    const groups = new Map()
    for (const file of files.map((f) => path.relative(process.cwd(), f))) {
        const dir = PACKAGE.exec(file)?.[0] ?? '.'
        groups.set(dir, [...(groups.get(dir) ?? []), file])
    }
    return [...groups].map(([dir, list]) =>
        dir === '.'
            ? `eslint --fix -- ${list.map(quote).join(' ')}`
            : `pnpm --dir ${dir} exec eslint --fix -- ${list.map((f) => quote(path.relative(dir, f))).join(' ')}`,
    )
}

export default {
    '**/*.{js,cjs,mjs,ts,mts,cts,tsx}': eslint,
    '**/*.{js,cjs,mjs,ts,mts,cts,tsx,json,md,yml,yaml}': 'prettier --write',
}
