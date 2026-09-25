import { createConfig } from '../../eslint.config.js'

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
    {
        // The zero-dependency promise, enforced: published code imports only its own modules. Every
        // tool is installed at the workspace root, so nothing else would catch a stray bare import.
        files: ['src/**/*.ts'],
        rules: {
            'no-restricted-imports': [
                'error',
                {
                    patterns: [
                        {
                            regex: '^(?!\\.{1,2}/)',
                            message:
                                '@frappeforge/client has zero runtime dependencies: src/ imports only its own modules.',
                        },
                    ],
                },
            ],
        },
    },
])
