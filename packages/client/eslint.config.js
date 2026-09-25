import { createConfig } from '../../eslint.config.js'

/** The zero-dependency promise: published code imports only its own modules. Every tool is installed at
 * the workspace root, so nothing else would catch a stray bare import. */
const zeroDependencies = {
    regex: '^(?!\\.{1,2}/)',
    message: '@frappeforge/client has zero runtime dependencies: src/ imports only its own modules.',
}

/** The layer patterns read a specifier's first segments, so `./http/../client.js` must not reach them. */
const normalizedPaths = {
    regex: '/\\.{1,2}/',
    message: 'Import paths are normalized: no "." or ".." segment after the start.',
}

/**
 * A `no-restricted-imports` override for `files`: the zero-dependency and normalized-path patterns
 * plus the layer's own.
 *
 * @param {string[]} files
 * @param {...{ regex: string, message: string }} layer
 */
function imports(files, ...layer) {
    return {
        files,
        rules: { 'no-restricted-imports': ['error', { patterns: [zeroDependencies, normalizedPaths, ...layer] }] },
    }
}

const onlySend = 'Only src/http/send.ts calls fetch: one place for headers, timeouts and error mapping.'

export default createConfig(import.meta.dirname, [
    {
        // Three projects: `tsconfig.json` (published `src/`, web globals only),
        // `tsconfig.test.json` (tests and configs, Node types) and `tests/register` (the isolated
        // Register augmentation). Type-aware rules need all of them.
        files: ['**/*.ts', '**/*.mts', '**/*.cts'],
        languageOptions: {
            parserOptions: {
                projectService: false,
                project: ['./tsconfig.json', './tsconfig.test.json', './tests/register/tsconfig.json'],
            },
        },
    },
    // Layers, enforced: `http/` is the bottom, `config.ts` sits on it, `client.ts` on both, and only
    // `index.ts` imports `client.ts`. In flat config a later `no-restricted-imports` replaces the
    // earlier options for the same files, so every layer repeats the zero-dependency pattern.
    imports(['src/**/*.ts'], { regex: '(^|/)client\\.js$', message: 'Only src/index.ts imports client.ts.' }),
    imports(['src/index.ts']),
    imports(['src/http/**/*.ts'], {
        regex: '^\\.\\./(?!(errors|types)\\.js$)',
        message: 'http/ is the bottom layer: it imports only ../errors.js, ../types.js and its siblings.',
    }),
    imports(['src/config.ts'], {
        regex: '^\\./(?!(errors|types)\\.js$|http/)',
        message: 'config.ts imports only errors.js, types.js and http/.',
    }),
    imports(['src/client.ts'], {
        regex: '^\\./(?!(config|errors|types)\\.js$|http/)',
        message: 'client.ts imports only config.js, errors.js, types.js and http/.',
    }),
    {
        // One fetch call site: headers, timeouts and error mapping cannot be bypassed.
        files: ['src/**/*.ts'],
        rules: {
            'no-restricted-globals': ['error', { name: 'fetch', message: onlySend }],
            'no-restricted-properties': [
                'error',
                ...['globalThis', 'window', 'self'].map((object) => ({ object, property: 'fetch', message: onlySend })),
            ],
        },
    },
    {
        files: ['src/http/send.ts'],
        rules: { 'no-restricted-globals': 'off', 'no-restricted-properties': 'off' },
    },
])
