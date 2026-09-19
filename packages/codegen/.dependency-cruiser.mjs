/**
 * dependency-cruiser rules for @frappeforge/codegen. Run with `pnpm lint:deps`.
 *
 * Layer-boundary rules are added alongside the code that introduces the layers; the
 * baseline below applies to every package from day one.
 */
export default {
    forbidden: [
        {
            name: 'no-circular',
            severity: 'error',
            comment: 'Circular imports make the module graph impossible to reason about and can break tree-shaking.',
            from: {},
            to: { circular: true },
        },
        {
            name: 'no-orphans',
            severity: 'warn',
            comment: 'A module nothing imports and that imports nothing is probably dead code or a forgotten export.',
            // Entry points are imported by nobody inside src/ by definition.
            from: { orphan: true, pathNot: ['\\.d\\.ts$', '^src/(index|cli)\\.ts$'] },
            to: {},
        },
        {
            name: 'not-to-dev-dep',
            severity: 'error',
            comment: 'Published code must not depend on a devDependency; it would be missing for consumers.',
            from: { path: '^src/' },
            to: { dependencyTypes: ['npm-dev'] },
        },
        {
            name: 'not-to-unresolvable',
            severity: 'error',
            comment: 'Every import must resolve.',
            from: {},
            to: { couldNotResolve: true },
        },
        {
            name: 'no-deprecated-core',
            severity: 'error',
            comment: 'Do not depend on Node.js core modules that are deprecated or unsafe by default.',
            from: {},
            to: { dependencyTypes: ['core'], path: '^(punycode|domain|sys)$' },
        },
    ],
    options: {
        doNotFollow: { path: 'node_modules' },
        exclude: { path: '(^|/)(dist|coverage|tests)($|/)' },
        tsPreCompilationDeps: true,
        tsConfig: { fileName: 'tsconfig.json' },
        enhancedResolveOptions: {
            exportsFields: ['exports'],
            conditionNames: ['import', 'require', 'types'],
        },
        reporterOptions: {
            text: { highlightFocused: true },
        },
    },
}
