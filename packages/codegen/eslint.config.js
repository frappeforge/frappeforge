import { createConfig } from '../../eslint.config.js'

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
])
