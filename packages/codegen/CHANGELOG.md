# @frappeforge/codegen

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
