// `frappeforge-codegen` itself: parse the command line, resolve the settings, read the site, then
// write the module or check it. Everything outside the process comes in through `io`, so tests run
// it in-process.

import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

import {
    AuthenticationError,
    type AuthStrategy,
    type ClientOptions,
    createClient,
    InvalidArgumentError,
    tokenAuth,
} from '@frappeforge/client'

import { readIfExists, resolveConfig, UsageError } from './config.js'
import { parseFlags, usage } from './flags.js'
import { generate } from './generate.js'
import { VERSION } from './index.js'
import { loadFromSite } from './sources/site.js'

/** What a run reads and writes besides files: `process.env`, `process.cwd()`, the output streams, `fetch`. */
export interface IO {
    readonly env: Readonly<Record<string, string | undefined>>
    readonly cwd: string
    readonly stdout: { write(text: string): unknown }
    readonly stderr: { write(text: string): unknown }
    /** The client's `fetch`; the global one when absent. */
    readonly fetch?: ClientOptions['fetch']
}

function pluralize(count: number, noun: string): string {
    return `${String(count)} ${noun}${count === 1 ? '' : 's'}`
}

/** `tokenAuth()`, with its errors worded for the environment variables the user sets. */
function envTokenAuth(apiKey: string, apiSecret: string): AuthStrategy {
    try {
        return tokenAuth({ apiKey, apiSecret })
    } catch (error) {
        throw new UsageError(
            'FRAPPE_API_KEY and FRAPPE_API_SECRET must be visible ASCII characters without ":". ' +
                'Check them for a stray space or line break.',
            { cause: error },
        )
    }
}

/**
 * The message, then each `cause` that is an `Error` and that the output does not already say, so that
 * a network failure shows its reason.
 */
function formatError(error: Error): string {
    const lines = [`Error: ${error.message}`]
    for (let cause = error.cause; cause instanceof Error; cause = cause.cause) {
        if (!lines.join('\n').includes(cause.message)) lines.push(`  Cause: ${cause.message}`)
    }
    return `${lines.join('\n')}\n`
}

/**
 * Runs `frappeforge-codegen` with the arguments after the command name.
 *
 * @returns The exit code: 0 success, 1 failure or an out-of-date file with `--check`, 2 usage error.
 */
export async function main(argv: readonly string[], io: IO): Promise<number> {
    try {
        const flags = parseFlags(argv)
        if (flags.help) {
            io.stdout.write(usage)
            return 0
        }
        if (flags.version) {
            io.stdout.write(`${VERSION}\n`)
            return 0
        }
        const config = await resolveConfig(flags, io)
        const frappe = createClient({
            url: config.url,
            ...(config.siteName === undefined ? {} : { siteName: config.siteName }),
            auth: envTokenAuth(config.apiKey, config.apiSecret),
            // The client's default retries, so that a busy or restarting site does not fail the run.
            retry: {},
            ...(io.fetch === undefined ? {} : { fetch: io.fetch }),
        })
        const { docTypes, warnings: sourceWarnings } = await loadFromSite(frappe, config).catch((error: unknown) => {
            if (!(error instanceof AuthenticationError)) throw error
            throw new Error(
                `${config.url} rejected FRAPPE_API_KEY and FRAPPE_API_SECRET. ` +
                    'Check both; generating new keys for a user replaces the secret.',
                { cause: error },
            )
        })
        // Before generating: when nothing is left to generate, they say why.
        for (const warning of sourceWarnings) io.stderr.write(`Warning: ${warning}\n`)
        const { code, warnings } = generate(docTypes, { register: config.register, rename: config.rename })
        for (const warning of warnings) io.stderr.write(`Warning: ${warning}\n`)

        const relativeOut = path.relative(io.cwd, config.out)
        // A checkout with CRLF line endings (Git's `autocrlf`) holds the same module.
        const currentCode = (await readIfExists(config.out, `output file ${relativeOut}`))?.replaceAll('\r\n', '\n')
        if (flags.check) {
            if (currentCode === code) {
                io.stdout.write(`${relativeOut} is up to date.\n`)
                return 0
            }
            const problem = currentCode === undefined ? 'does not exist' : 'is out of date'
            io.stderr.write(`${relativeOut} ${problem}. Run the same command without --check.\n`)
            return 1
        }
        // An unchanged file is not rewritten, so watchers and dev servers do not rebuild.
        if (currentCode !== code) {
            await mkdir(path.dirname(config.out), { recursive: true })
            await writeFile(config.out, code)
        }
        const childTableCount = docTypes.filter((meta) => meta.istable).length
        io.stdout.write(
            `Generated ${pluralize(docTypes.length, 'DocType')}` +
                (childTableCount === 0 ? '' : ` (${pluralize(childTableCount, 'child table')})`) +
                ` → ${relativeOut}${currentCode === code ? ' (unchanged)' : ''}\n`,
        )
        return 0
    } catch (error) {
        // Bad options to the client (an invalid URL or site name) are usage errors too.
        if (error instanceof UsageError || error instanceof InvalidArgumentError) {
            io.stderr.write(`Error: ${error.message}\nRun frappeforge-codegen --help for usage.\n`)
            return 2
        }
        io.stderr.write(formatError(error as Error))
        return 1
    }
}
