# @frappeforge/codegen

## 0.8.0

### Minor Changes

- [#43](https://github.com/frappeforge/frappeforge/pull/43) [`4f32292`](https://github.com/frappeforge/frappeforge/commit/4f32292dea6ae1868fc946c51482240905595231) Thanks [@dhiashalabi](https://github.com/dhiashalabi)! - `frappeforge-codegen` generates types from a Frappe bench's app source when no site URL is given: run
  inside the bench, select with the same `--app`, `--module` and `--doctype`, and no site or credentials
  are needed. Each DocType's fields come in the form's order, with the custom fields and property setters
  that the bench's apps export in `custom/` folders and `fixtures/` applied, as on a site. `loadFromBench`
  does the same from code.

### Patch Changes

- Updated dependencies []:
  - @frappeforge/client@0.8.0

## 0.7.0

### Minor Changes

- [#41](https://github.com/frappeforge/frappeforge/pull/41) [`7b14353`](https://github.com/frappeforge/frappeforge/commit/7b143534f22baa35b0bcb44edcd240228a3530ae) Thanks [@dhiashalabi](https://github.com/dhiashalabi)! - Add the `frappeforge-codegen` CLI. It reads DocTypes from a running site — including custom fields and
  property setters — selected by name, module or app, and writes one typed module. Settings come from
  flags, the environment and a committed `frappeforge.json`, which `schema.json` describes for editors.
  `--check` fails CI when the committed module is out of date. Credentials are read only from
  `FRAPPE_API_KEY` and `FRAPPE_API_SECRET`, and a config file holding one is refused. A DocType reached
  through a module or app whose metadata the site cannot load is left out with a warning. `loadFromSite()`
  does the same reading from code, with any `@frappeforge/client` client.
  
  `generate()` now gives a field named like a standard field (such as `parent` on `Custom DocPerm`) the
  standard field's type, so the generated interface always extends `FrappeDoc`.

### Patch Changes

- Updated dependencies []:
  - @frappeforge/client@0.7.0

## 0.6.0

### Minor Changes

- [#38](https://github.com/frappeforge/frappeforge/pull/38) [`e5bbbae`](https://github.com/frappeforge/frappeforge/commit/e5bbbae0a32bb7bd001577238fa00a107b4572d4) Thanks [@dhiashalabi](https://github.com/dhiashalabi)! - Add `generate()` and `normalizeDocType()`: turn DocType metadata into one TypeScript module with an
  interface per DocType, named like Frappe's controller class (`Sales Order` → `SalesOrder`), a
  `DocTypes` map, and an augmentation of `Register` that types `@frappeforge/client` automatically. The
  types follow what Frappe returns: empty fields are optional and `null` in lists, numbers and checks
  are always present, and masked fields accept their placeholder. The output is deterministic, so it can
  be committed and checked in CI.

## 0.5.0

No changes in this release.

## 0.4.0

No changes in this release.

## 0.3.0

No changes in this release.

## 0.2.0

No changes in this release.

## 0.1.0

### Patch Changes

- [#11](https://github.com/frappeforge/frappeforge/pull/11) [`6064b96`](https://github.com/frappeforge/frappeforge/commit/6064b963ed7ac83f7ffbce03e6310567a42b3a2c) Thanks [@dhiashalabi](https://github.com/dhiashalabi)! - Packages are now published as ES modules only and require Node.js 22.12 or newer. CommonJS code can
  still `require()` them: Node 22.12+ loads ES modules through `require()` natively.
