// Public entry point. The package documentation comes from package.json via the tsdown banner.

export { bearerAuth, type BearerAuthOptions } from './auth/bearer.js'
export { sessionAuth, type SessionAuthOptions } from './auth/session.js'
export type { AuthStrategy } from './auth/strategy.js'
export { tokenAuth, type TokenAuthOptions } from './auth/token.js'
export { createClient, type FrappeClient } from './client.js'
export type { ClientOptions } from './config.js'
export * from './errors.js'
export type { AuthNamespace, LoginResult } from './namespaces/auth.js'
export type { CallNamespace } from './namespaces/call.js'
export type { DocNamespace } from './namespaces/doc.js'
export type { FileDoc, FileNamespace, UploadOptions } from './namespaces/file.js'
export * from './types.js'

/** The published version of this package, injected at build time. */
export const VERSION: string = __VERSION__
