// Public entry point. The package documentation comes from package.json via the tsdown banner.

export { createClient, type FrappeClient } from './client.js'
export type { ClientOptions } from './config.js'
export * from './errors.js'
export * from './types.js'

/** The published version of this package, injected at build time. */
export const VERSION: string = __VERSION__
