/** Conventional commits: `type(scope): subject`. Scopes are the workspace packages plus repo areas. */
export default {
    extends: ['@commitlint/config-conventional'],
    rules: {
        'scope-enum': [2, 'always', ['client', 'codegen', 'react', 'deps', 'ci', 'docs', 'repo', 'release']],
        'subject-case': [2, 'never', ['start-case', 'pascal-case', 'upper-case']],
        'body-max-line-length': [1, 'always', 120],
    },
}
