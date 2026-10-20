// The command line of `frappeforge-codegen`: its options, its help text, and parsing.

import { parseArgs } from 'node:util'

import { UsageError } from './config.js'

/**
 * The options, as `parseArgs` takes them. None has a default: an option that is not given stays
 * `undefined`, so the environment and the config file can fill it in.
 */
export const options = {
    config: { type: 'string', short: 'c' },
    url: { type: 'string', short: 'u' },
    'site-name': { type: 'string' },
    doctype: { type: 'string', short: 'd', multiple: true },
    module: { type: 'string', short: 'm', multiple: true },
    app: { type: 'string', multiple: true },
    out: { type: 'string', short: 'o' },
    register: { type: 'boolean' },
    check: { type: 'boolean' },
    'env-file': { type: 'string' },
    help: { type: 'boolean', short: 'h' },
    version: { type: 'boolean', short: 'v' },
} as const

/** The help text. */
export const usage = `Usage: frappeforge-codegen [options]

Generates TypeScript types for the DocTypes of a Frappe site, or of the apps of the
Frappe bench it runs in.

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

Credentials are read only from FRAPPE_API_KEY and FRAPPE_API_SECRET; a bench needs none.
Exit codes: 0 success, 1 failure or out of date, 2 usage error.
`

/** The parsed command line. Lists are named like the config file's keys, and paths say they are files. */
export interface Flags {
    configFile: string | undefined
    url: string | undefined
    siteName: string | undefined
    doctypes: readonly string[]
    modules: readonly string[]
    apps: readonly string[]
    out: string | undefined
    register: boolean | undefined
    check: boolean
    envFile: string | undefined
    help: boolean
    version: boolean
}

/**
 * Parses the arguments after the command name.
 *
 * @throws `UsageError` for an unknown option, a missing or empty value, or a positional argument.
 */
export function parseFlags(argv: readonly string[]): Flags {
    let values
    try {
        ;({ values } = parseArgs({ args: [...argv], options, strict: true, allowNegative: true }))
    } catch (error) {
        // Only `ERR_PARSE_ARGS_*` errors reach here: the options themselves are valid.
        throw new UsageError((error as Error).message, { cause: error })
    }
    for (const [name, value] of Object.entries(values)) {
        if (value === '' || (Array.isArray(value) && value.includes('')))
            throw new UsageError(`--${name} needs a value.`)
    }
    return {
        configFile: values.config,
        url: values.url,
        siteName: values['site-name'],
        doctypes: values.doctype ?? [],
        modules: values.module ?? [],
        apps: values.app ?? [],
        out: values.out,
        register: values.register,
        check: values.check ?? false,
        envFile: values['env-file'],
        help: values.help ?? false,
        version: values.version ?? false,
    }
}
