// Public entry point. The package documentation comes from package.json via the tsdown banner.

export { generate, type GenerateOptions, type GenerateResult } from './generate.js'
export { type DocTypeMeta, type FieldMeta, normalizeDocType } from './meta.js'
export { loadFromSite, type LoadFromSiteResult } from './sources/site.js'

/** The published version of this package, injected at build time. */
export const VERSION: string = __VERSION__
