# Contributing to FrappeForge

Thanks for helping. This guide covers the local setup, the quality gate every change must
pass, and how releases work. It applies to every package in the repository.

## Prerequisites

- **Node.js 22.18 or newer** to build the repository (`.nvmrc` pins 24, the current Active LTS). The
  published packages need only Node.js 22.12+; CI tests them on exactly 22.12.0.
- **pnpm 12**, managed by Corepack: `corepack enable` once, then pnpm is picked up from
  `packageManager` in `package.json` automatically.

## Setup

```sh
git clone https://github.com/frappeforge/frappeforge.git
cd frappeforge
pnpm install
pnpm gate
```

`pnpm install` also installs the git hooks (Husky). `pnpm gate` runs the full quality gate;
it must be green before you open a pull request.

## The quality gate

`pnpm gate` runs, in order, exactly what CI runs:

| Step                 | What it checks                                                                                                                                                            |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm build`         | tsdown, then `scripts/verify-dist.mjs` checks the real `dist/` artifacts load through `import` and `require()`; `api:check`, `publint` and `verify:packed` use this build |
| `pnpm typecheck`     | `tsc` for the root tooling (shared configs, `scripts/`), then per package with the strict base config                                                                     |
| `pnpm lint`          | ESLint (type-aware) for the root and per package; published `src/` may import only its own modules (plus `node:` built-ins in codegen)                                    |
| `pnpm format:check`  | Prettier                                                                                                                                                                  |
| `pnpm knip`          | unused files, exports and dependencies, in default and production mode                                                                                                    |
| `pnpm test`          | Vitest with **100% coverage per file** (thresholds fail the run)                                                                                                          |
| `pnpm api:check`     | API Extractor: the public surface matches the committed `etc/*.api.md` report, every public symbol is documented, and its TSDoc is valid                                  |
| `pnpm publint`       | `package.json` and `exports` correctness                                                                                                                                  |
| `pnpm verify:packed` | Installs the packed tarballs, then runs ESM, `require()` and CLI consumers and compiles NodeNext (ESM + CJS) and `bundler` type consumers                                 |

Run a single step while iterating, for example `pnpm --filter @frappeforge/client test:watch`.

Package configs (`vitest.config.ts`, `tsdown.config.ts`, `api-extractor.json`) extend the shared
root files `vitest.shared.ts`, `tsdown.shared.ts` and `api-extractor.base.json`; change a default there,
and state only what differs in a package.

### When `api:check` fails

Either you changed the public API surface, or a public symbol lacks documentation
(`ae-undocumented`) or has invalid TSDoc. For a surface change, review the diff it prints; if the
change is intended, regenerate the report and commit it:

```sh
pnpm api:extract
git add packages/*/etc/*.api.md
```

API Extractor analyses with the TypeScript version it bundles and prints a warning that the project
uses a newer one. The warning is expected and harmless while the published `.d.ts` files use no syntax
that is new in the project's TypeScript version.

## Making a change

1. Branch from `main`: `git switch -c feat/client-something` (any prefix is fine).
2. Write the code **and** the tests. Coverage is 100% per file; untested branches fail the gate.
3. Add a changeset if you changed a package: `pnpm changeset`, choose the package(s) and the
   bump, and write the entry for _users_ of the package — it becomes the changelog line.
   Pure CI / docs / tooling changes need no changeset; add the `skip-changeset` label to the PR.
4. Give the pull request a [Conventional Commit](https://www.conventionalcommits.org/) title; the
   `pr-title` check enforces it, and the title becomes the single squash commit on `main` (local
   commit messages are not checked). Scopes: `client`, `codegen`, `realtime`, `react`, `deps`, `ci`,
   `docs`, `repo`, `release`. Example: `feat(client): add cookie auth strategy`.
5. Open a pull request. CI runs the Node-independent checks once, the tests and packed-consumer
   checks on Node 22.12.0 (the consumer floor, built on 24), 24, 26 (Linux) and 24 (Windows), a
   dependency audit, and zizmor on the workflows themselves. One approving review from a code owner is required; PRs are squash-merged.

## Repository conventions

- Every GitHub Action is pinned to a full commit SHA with a `# vX.Y.Z` comment; Dependabot updates
  both.
- No dependency may run install scripts (`allowBuilds` in `pnpm-workspace.yaml` is empty).

## Package conventions

- ESM only: `dist/index.js` + `dist/index.d.ts`, and every `exports` entry lists `types` before
  `default`. A single build means a single copy of each class per process, so `instanceof` checks on
  errors always work. CommonJS users `require()` the ES module natively on Node 22.12+.
- Two Node floors: packages declare `engines.node >=22.12` (what users need); the root declares
  `>=22.18` (what the build tools need).
- `build` runs first so that a package depending on another is checked against its **built** output,
  exactly what users install. For watch mode, run `pnpm --filter @frappeforge/client exec tsdown --watch` in a second
  terminal.
- `@frappeforge/client` has **zero runtime dependencies**. Do not add one without a discussion first.
- No hidden network calls: nothing in a package contacts a server unless the caller asked for it.
- Errors are typed and documented; a user should never have to string-match a message.

## Releases

Merging to `main` runs the release workflow. Pending changesets are collected into a
"Version Packages" pull request, opened by the `frappeforge-release` GitHub App so that it
gets the same CI checks as any other PR; merging it publishes the affected packages to npm
with provenance and creates GitHub releases. Maintainers never publish from a laptop.

## Questions

Open a [discussion](https://github.com/frappeforge/frappeforge/discussions). For security
issues, follow [SECURITY.md](.github/SECURITY.md) instead of opening anything public.
