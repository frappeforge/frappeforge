# Changesets

Every pull request that changes a published package under `packages/` must include a
changeset. Run `pnpm changeset`, pick the affected packages and the semver bump, and write
one or two sentences aimed at users of the package — that text becomes the changelog entry.

Pull requests that touch only CI, docs, tests, or repository tooling do not need one; apply
the `skip-changeset` label so the check passes.

On merge to `main`, the release workflow collects pending changesets into a "Version
Packages" pull request. Merging that PR publishes the new versions to npm.

Reference: <https://github.com/changesets/changesets>
