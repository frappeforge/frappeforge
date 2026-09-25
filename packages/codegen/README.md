# @frappeforge/codegen

Generates TypeScript types for your Frappe DocTypes from a live site, so
`@frappeforge/client` calls are typed end to end.

> **Status:** pre-release scaffold. The generator is under construction; the CLI currently
> only reports its version. Watch the [repository](https://github.com/frappeforge/frappeforge)
> for progress.

## Install

```sh
pnpm add -D @frappeforge/codegen
pnpm exec frappeforge-codegen --version
```

Published as an ES module only. CommonJS code can still `require('@frappeforge/codegen')` on Node.js 22.12+
(22.12 itself prints a one-time experimental warning; 22.13+ does not).

## License

[MIT](./LICENSE). FrappeForge is an independent community project, not affiliated with
Frappe Technologies.
