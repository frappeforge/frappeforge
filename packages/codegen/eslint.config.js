import { createConfig } from '../../eslint.config.js'

/**
 * The generator core: metadata in, TypeScript text out. Pure and deterministic, because committed
 * output is compared byte for byte in CI: no I/O, no clock, no randomness, no locale.
 */
const pureModules = ['src/meta.ts', 'src/mapping.ts', 'src/identifiers.ts', 'src/generate.ts']
const purityMessage =
    'The generator core is pure and deterministic: no I/O, clock, randomness or locale, so the same metadata always gives the same output.'

export default createConfig(import.meta.dirname, [
    {
        // Published code imports only its own modules and Node built-ins. Every tool is installed at the
        // workspace root, so nothing else would catch a stray bare import; list new runtime
        // dependencies here and in package.json together.
        files: ['src/**/*.ts'],
        rules: {
            'no-restricted-imports': [
                'error',
                {
                    patterns: [
                        {
                            regex: '^(?!\\.{1,2}/|node:)',
                            message: 'src/ imports only its own modules, node: built-ins and declared dependencies.',
                        },
                    ],
                },
            ],
        },
    },
    {
        // A later `no-restricted-imports` replaces the one above for these files, so it states the
        // whole rule: sibling modules only. `@frappeforge/client` appears only in the generated text.
        files: pureModules,
        rules: {
            'no-restricted-imports': [
                'error',
                {
                    patterns: [
                        {
                            regex: '^(?!\\./)',
                            message: `${purityMessage} It imports only its sibling modules: no node: built-ins, no packages.`,
                        },
                    ],
                },
            ],
            'no-restricted-globals': [
                'error',
                ...['process', 'console', 'fetch', 'Buffer', 'Date', 'Intl', 'crypto'].map((name) => ({
                    name,
                    message: purityMessage,
                })),
            ],
            'no-restricted-properties': [
                'error',
                { object: 'Math', property: 'random', message: purityMessage },
                {
                    property: 'localeCompare',
                    message: `${purityMessage} Compare strings by code point: localeCompare depends on the machine's locale.`,
                },
            ],
        },
    },
])
