# @frappeforge/codegen

Generates TypeScript types for your Frappe DocTypes from a live site or from your bench's app source, so
`@frappeforge/client` calls are typed end to end.

> **Status: pre-release.** The CLI and API may change before `1.0.0`. Supported Frappe versions: v15 and
> v16.

- **The types your forms see.** Metadata is read as the site's forms read it: custom fields and property
  setters included, child tables with their parents.
- **Or straight from the source.** Inside a Frappe bench, the DocType files of its apps are read, with
  the custom fields and property setters they export: no site, no credentials.
- **Select by DocType, module or app.** One command writes one module with an interface per DocType.
- **Made for CI.** `--check` fails when the committed module no longer matches the site or the bench.
- **Credentials stay out of files and command lines.** They are read only from the environment.

## Install

```sh
pnpm add -D @frappeforge/codegen
pnpm add @frappeforge/client
```

## Quick start

Create an API key and secret on the site (**User → Settings → API Access**) and put them in a `.env`
file that is never committed:

```sh
# .env — add it to .gitignore
FRAPPE_API_KEY=…
FRAPPE_API_SECRET=…
```

Then generate:

```sh
pnpm exec frappeforge-codegen --env-file .env --url https://example.com --module Selling --doctype ToDo
# Generated 14 DocTypes (5 child tables) → src/frappe.generated.ts
```

The module augments the client's `Register`: once it is part of your TypeScript project, every client is
typed with no type argument.

```ts
import { createClient } from '@frappeforge/client'

const frappe = createClient({ url: 'https://example.com' })
const order = await frappe.doc.get('Sales Order', 'SO-0001') // SalesOrder
```

Pass `--no-register` to type one client only instead: `createClient<DocTypes>({ url })`, with `DocTypes`
imported from the generated module.

## From the bench

Without a site URL, the command reads the Frappe bench it runs in: the bench directory is found by going
up from the current one (or from the config file's), as `bench` itself finds it. The DocTypes come from
the JSON files of the apps in `apps/`, so no site has to run and no credentials are needed:

```sh
cd frappe-bench/apps/my_app/frontend
pnpm exec frappeforge-codegen --app my_app --doctype User
# Generated 9 DocTypes (3 child tables) → src/frappe.generated.ts
```

The metadata is what a site with these apps gives: each DocType's fields in the form's order, with the
custom fields and property setters that every app on the bench exports — in its modules' `custom/`
folders (**Customize Form → Export Customizations**) or in its `fixtures/`. Your app's custom fields on
frappe's `User`, or on ERPNext's `Customer`, are part of those DocTypes.

A site has more than the source, so read the site instead for:

- custom fields an app creates in Python, such as with `create_custom_fields` in an install hook or a
  patch;
- Custom DocTypes, and changes made in the Desk but not exported.

Every app on the bench counts, also one a given site does not have installed.

## Selecting DocTypes

| Option             | Generates                                      | On a site, the API user needs |
| ------------------ | ---------------------------------------------- | ----------------------------- |
| `--doctype <name>` | that DocType                                   | any logged-in user            |
| `--module <name>`  | every DocType of the module, such as `Selling` | System Manager role           |
| `--app <name>`     | every DocType of an app, such as `hrms`        | System Manager role           |

Each option can be repeated, and they combine. Child tables always come with the DocTypes that use them.
On a site, selecting by module or app lists the site's DocTypes, which only a System Manager may do; an
app is one installed on the site. On a bench, an app is one in its `apps/` folder. At least one
DocType, module or app is required: generating a whole site or bench is never done by accident.

A DocType reached through a module or an app whose metadata the site cannot load — one that links to,
or has a child table from, an app that is not installed — is left out with a warning. A DocType you
name with `--doctype` must load.

## Config file

Commit a `frappeforge.json` next to your `package.json`, and the command needs no options:

```json
{
    "$schema": "./node_modules/@frappeforge/codegen/schema.json",
    "url": "https://example.com",
    "modules": ["Selling"],
    "doctypes": ["Customer", "Item"],
    "out": "src/frappe.generated.ts",
    "rename": { "Item": "ErpItem" }
}
```

| Key        | Meaning                                                                            | Default                   |
| ---------- | ---------------------------------------------------------------------------------- | ------------------------- |
| `url`      | The site's URL; without one, the bench the file is in is read                      | —                         |
| `siteName` | The site's name, when the URL's host is not the site's name (`X-Frappe-Site-Name`) | —                         |
| `doctypes` | DocTypes to generate                                                               | —                         |
| `modules`  | Modules whose DocTypes are all generated                                           | —                         |
| `apps`     | Apps whose DocTypes are all generated                                              | —                         |
| `out`      | The output file, relative to the config file                                       | `src/frappe.generated.ts` |
| `register` | Augment `@frappeforge/client`'s `Register`                                         | `true`                    |
| `rename`   | Interface names to use instead of the derived ones, by DocType                     | —                         |

The `$schema` line gives your editor completion and checks. The file must be plain JSON, and any other
key is an error. A key whose name contains `key`, `secret`, `token`, `password`, `auth` or `credential`
(`apiKey`, `accessToken`, …) is refused with an explanation, at any depth.

### Where settings come from

Flags win over environment variables, which win over the config file. Lists combine instead: DocTypes,
modules and apps from the file and from the flags are all generated. With a site URL from any of them,
the site is read; without one, the bench. A site name without a site URL is a usage error.

| Setting     | Flag                                     | Environment         | Config file |
| ----------- | ---------------------------------------- | ------------------- | ----------- |
| Site URL    | `--url`                                  | `FRAPPE_URL`        | `url`       |
| Site name   | `--site-name`                            | `FRAPPE_SITE_NAME`  | `siteName`  |
| Output file | `--out` (relative to the current folder) | —                   | `out`       |
| `Register`  | `--register`, `--no-register`            | —                   | `register`  |
| API key     | —                                        | `FRAPPE_API_KEY`    | —           |
| API secret  | —                                        | `FRAPPE_API_SECRET` | —           |

`--env-file <file>` reads variables from a file; a variable already set in the environment wins, as
with Node.js's own `--env-file`. There are no flags for credentials, because command lines end up in shell
history and process lists.

## In CI

Commit the generated module, and check it in CI:

```sh
pnpm exec frappeforge-codegen --check
```

`--check` writes nothing. It exits with `1` and says so when the committed module differs from what the
site or the bench gives now, or does not exist. For a site, set `FRAPPE_API_KEY` and `FRAPPE_API_SECRET`
as CI secrets. For a bench, no secret is needed: check your app out as `apps/<app>`, next to the apps it
needs. With GitHub Actions:

```yaml
- uses: actions/checkout@v5
  with:
      path: apps/my_app
# Only when you generate frappe's DocTypes, or your app customizes them.
- uses: actions/checkout@v5
  with:
      repository: frappe/frappe
      ref: version-15
      path: apps/frappe
- run: pnpm exec frappeforge-codegen --check
  working-directory: apps/my_app/frontend
```

The check compares bytes, so **exclude the generated file from formatters**, for example in
`.prettierignore`:

```text
src/frappe.generated.ts
```

Line endings do not matter: a checkout with CRLF line endings passes. The module carries no version, so
upgrading `@frappeforge/codegen` alone never fails the check; only a change in the output does.

## Options

```text
Usage: frappeforge-codegen [options]

Options:
  -c, --config <file>     Config file (default: frappeforge.json, when it exists)
  -u, --url <url>         Site URL (env FRAPPE_URL); without one, the bench is read
      --site-name <name>  Site name, when the URL's host is not the site's name (env FRAPPE_SITE_NAME)
  -d, --doctype <name>    Include a DocType; repeatable
  -m, --module <name>     Include every DocType of a module; repeatable
      --app <name>        Include every DocType of an app; repeatable
  -o, --out <file>        Output file (default: src/frappe.generated.ts)
      --no-register       Do not augment @frappeforge/client's Register
      --check             Write nothing; exit 1 when the output file is out of date
      --env-file <file>   Read environment variables from a file
  -h, --help              Show this help
  -v, --version           Show the version
```

Exit codes: `0` success, `1` failure or an out-of-date module with `--check`, `2` usage error (an
unknown option, an invalid config file, a file that cannot be read, no site and no bench, or a missing or
malformed setting). Warnings, such as a field type the generator does not know, go to standard error and
do not change the exit code.

## From code

The same steps are available as functions, with any client — an API key, a session or a bearer token:

```ts
import { writeFile } from 'node:fs/promises'

import { createClient, tokenAuth } from '@frappeforge/client'
import { generate, loadFromBench, loadFromSite } from '@frappeforge/codegen'

const frappe = createClient({ url: 'https://example.com', auth: tokenAuth({ apiKey, apiSecret }) })
const { docTypes, warnings: sourceWarnings } = await loadFromSite(frappe, { modules: ['Selling'] })
const { code, warnings } = generate(docTypes, { rename: { Item: 'ErpItem' } })
await writeFile('src/frappe.generated.ts', code)
for (const warning of [...sourceWarnings, ...warnings]) console.warn(warning)
```

`loadFromSite` reads up to four DocTypes at once. `loadFromBench` reads a bench's source instead, with the
same selection:

```ts
const docTypes = await loadFromBench('../frappe-bench', { apps: ['my_app'], doctypes: ['User'] })
```

`generate` is pure: the same metadata always gives the same module.

## Requirements

- Node.js 22.12 or newer.
- Published as an ES module only. CommonJS code can still `require('@frappeforge/codegen')` on Node.js
  22.12+ (22.12 itself prints a one-time experimental warning; 22.13+ does not).

## License

[MIT](./LICENSE). FrappeForge is an independent community project, not affiliated with
Frappe Technologies.
