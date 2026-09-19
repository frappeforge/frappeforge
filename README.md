<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/frappeforge/.github/main/profile/assets/frappeforge-banner-dark.png">
    <img src="https://raw.githubusercontent.com/frappeforge/.github/main/profile/assets/frappeforge-banner-light.png" alt="FrappeForge — modern tooling for Frappe" width="640">
  </picture>
</p>

<p align="center">
  <a href="https://github.com/frappeforge/frappeforge/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/frappeforge/frappeforge/actions/workflows/ci.yml/badge.svg"></a>
  <a href="./LICENSE"><img alt="MIT license" src="https://img.shields.io/badge/license-MIT-blue.svg"></a>
</p>

TypeScript-first tooling for building applications on the
[Frappe Framework](https://frappeframework.com) and ERPNext: a zero-dependency API client,
a DocType type generator, and (coming) framework integrations — all in one repository,
released together.

> **Status: pre-release.** The packages below are being built from the ground up. Nothing
> published from this repository is stable until `1.0.0`.

## Packages

| Package                                    | Description                                                                                                 | Version                                                                                                                |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| [`@frappeforge/client`](packages/client)   | Zero-dependency, `fetch`-native client for the Frappe REST API. Node, browsers, workers, and edge runtimes. | [![npm](https://img.shields.io/npm/v/@frappeforge/client?label=)](https://www.npmjs.com/package/@frappeforge/client)   |
| [`@frappeforge/codegen`](packages/codegen) | Generates TypeScript types for your DocTypes from a live site.                                              | [![npm](https://img.shields.io/npm/v/@frappeforge/codegen?label=)](https://www.npmjs.com/package/@frappeforge/codegen) |
| `@frappeforge/react`                       | React hooks on TanStack Query with realtime cache sync.                                                     | planned                                                                                                                |

## Principles

- **Typed end to end.** Your DocTypes become your types; the compiler catches mistakes before the server does.
- **Zero runtime dependencies** in the core client. Nothing to audit, nothing to break.
- **Runs everywhere `fetch` runs.** No Node-only or browser-only forks.
- **Stable, documented API.** Semantic versioning, changesets, and a committed API report on every release.
- **Boring by design.** Predictable behavior, explicit errors, no hidden network calls.

## Quick start

```sh
pnpm add @frappeforge/client
```

```ts
import { VERSION } from '@frappeforge/client'

console.log(VERSION) // the client API lands here as it is built
```

## Contributing

Bug reports, feature requests, and pull requests are welcome. Start with
[CONTRIBUTING.md](CONTRIBUTING.md) for the local setup and the `pnpm gate` workflow, and
please follow the [Code of Conduct](CODE_OF_CONDUCT.md).

To report a security issue, see [SECURITY.md](.github/SECURITY.md) — never open a public issue.

## License

[MIT](LICENSE).

FrappeForge is an independent community project. It is **not affiliated with, endorsed by,
or maintained by Frappe Technologies**. "Frappe" and "ERPNext" are trademarks of Frappe
Technologies Pvt. Ltd.
