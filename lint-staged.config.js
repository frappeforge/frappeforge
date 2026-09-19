import path from 'node:path'

function quote(file) {
    return `'${file.replaceAll("'", "'\\''")}'`
}

/** Runs each package's own ESLint config against only the staged files inside that package. */
function eslintIn(pkg) {
    return (files) => {
        const args = files.map((file) => quote(path.relative(pkg, file))).join(' ')
        return `pnpm --dir ${pkg} exec eslint --fix -- ${args}`
    }
}

export default {
    'packages/client/**/*.{js,cjs,mjs,ts,mts,cts}': eslintIn('packages/client'),
    'packages/codegen/**/*.{js,cjs,mjs,ts,mts,cts}': eslintIn('packages/codegen'),
    '**/*.{js,cjs,mjs,ts,mts,cts,json,md,yml,yaml}': 'prettier --write',
}
