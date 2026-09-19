/**
 * Shared ESLint flat config for every workspace package.
 *
 * Packages import `createConfig` and pass their own directory so typescript-eslint's
 * type-aware rules resolve the right `tsconfig.json`. The default export lints the
 * repository root itself (scripts and config files); packages are excluded there because
 * each one lints itself with its own tsconfig.
 */
import js from '@eslint/js'
import vitest from '@vitest/eslint-plugin'
import { defineConfig, globalIgnores } from 'eslint/config'
import eslintConfigPrettier from 'eslint-config-prettier'
import simpleImportSort from 'eslint-plugin-simple-import-sort'
import tsdoc from 'eslint-plugin-tsdoc'
import globals from 'globals'
import tseslint from 'typescript-eslint'

const importSort = {
    plugins: { 'simple-import-sort': simpleImportSort },
    rules: {
        'simple-import-sort/imports': 'error',
        'simple-import-sort/exports': 'error',
    },
}

/**
 * @param {string} tsconfigRootDir Absolute path of the package that owns the tsconfig.
 * @param {import('eslint').Linter.Config[]} [overrides] Package-specific additions, applied last.
 */
export function createConfig(tsconfigRootDir, overrides = []) {
    return defineConfig(
        globalIgnores(['dist/**', 'coverage/**', 'node_modules/**', 'temp/**', 'etc/**']),
        js.configs.recommended,
        {
            files: ['**/*.ts', '**/*.mts', '**/*.cts'],
            extends: [tseslint.configs.strictTypeChecked, tseslint.configs.stylisticTypeChecked, importSort],
            languageOptions: {
                parserOptions: {
                    projectService: true,
                    tsconfigRootDir,
                },
            },
            rules: {
                '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
                '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
                '@typescript-eslint/explicit-module-boundary-types': 'error',
            },
        },
        {
            // Published source: TSDoc must parse, because API Extractor and the docs generator read it.
            files: ['src/**/*.ts'],
            plugins: { tsdoc },
            rules: { 'tsdoc/syntax': 'error' },
        },
        {
            files: ['tests/**/*.ts'],
            extends: [vitest.configs.recommended],
            rules: {
                'vitest/no-focused-tests': 'error',
                'vitest/no-disabled-tests': 'error',
                // Type-level tests assert with `expectTypeOf` / `assertType`, not `expect`.
                'vitest/expect-expect': ['error', { assertFunctionNames: ['expect', 'expectTypeOf', 'assertType'] }],
            },
        },
        {
            files: ['**/*.js', '**/*.mjs', '**/*.cjs'],
            extends: [importSort],
            languageOptions: { globals: { ...globals.node } },
        },
        ...overrides,
        eslintConfigPrettier,
    )
}

export default createConfig(import.meta.dirname, [globalIgnores(['packages/**', 'docs/**', 'examples/**'])])
