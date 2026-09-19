import { createConfig } from '../../eslint.config.js'

export default createConfig(import.meta.dirname, [
    {
        // Two projects: `tsconfig.json` (published `src/`, web globals only) and
        // `tsconfig.test.json` (tests and configs, Node types). Type-aware rules need both.
        files: ['**/*.ts', '**/*.mts', '**/*.cts'],
        languageOptions: {
            parserOptions: {
                projectService: false,
                project: ['./tsconfig.json', './tsconfig.test.json'],
            },
        },
    },
])
