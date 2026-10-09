// The settings of one run: the config file, the environment and the flags, merged and validated.
// Flags win over the environment, which wins over the config file; DocType, module and app lists
// are combined from the file and the flags. Credentials come only from the environment.

import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { parseEnv } from 'node:util'

import type { Flags } from './flags.js'

/** A mistake in how the command was called, answered with exit code 2. */
export class UsageError extends Error {
    override readonly name = 'UsageError'
}

/** Where the module is written when neither `--out` nor the config file says: relative to the config file, or to the current folder without one. */
export const DEFAULT_OUT = 'src/frappe.generated.ts'

/** The keys a config file may have. `schema.json` lists the same ones. */
export const configFileKeys: readonly string[] = [
    '$schema',
    'url',
    'siteName',
    'doctypes',
    'modules',
    'apps',
    'out',
    'register',
    'rename',
]

/** Everything one run needs, validated. */
export interface ResolvedConfig {
    url: string
    siteName: string | undefined
    apiKey: string
    apiSecret: string
    doctypes: readonly string[]
    modules: readonly string[]
    apps: readonly string[]
    /** Absolute path of the output file. */
    out: string
    register: boolean
    rename: Readonly<Record<string, string>>
}

/** A validated config file. `out`, given or the default, is absolute: resolved against the file's folder. */
interface ConfigFile {
    url: string | undefined
    siteName: string | undefined
    doctypes: readonly string[]
    modules: readonly string[]
    apps: readonly string[]
    out: string
    register: boolean | undefined
    rename: Readonly<Record<string, string>>
}

const DEFAULT_CONFIG_FILE = 'frappeforge.json'

/**
 * Whether a key name holds a credential: `apiKey`, `api_key`, `FRAPPE_API_SECRET`, `accessToken`, `auth`,
 * `password`, … No config file key contains these words.
 */
function isCredentialKey(key: string): boolean {
    return /key|secret|token|password|passwd|auth|credential/iu.test(key)
}

type RawRecord = Readonly<Record<string, unknown>>

function isRecord(value: unknown): value is RawRecord {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** A file's text, or `undefined` when it does not exist. Any other failure is a usage error. */
export async function readIfExists(file: string, label: string): Promise<string | undefined> {
    try {
        return await readFile(file, 'utf8')
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
        throw new UsageError(`Cannot read ${label}: ${(error as Error).message}`, { cause: error })
    }
}

/**
 * The environment over the variables of `--env-file`: a variable set in the environment wins, as with
 * Node's `--env-file`. An empty value counts as unset, so it never hides the file's value.
 */
async function loadEnv(
    envFile: string | undefined,
    env: Readonly<Record<string, string | undefined>>,
    cwd: string,
): Promise<Readonly<Record<string, string>>> {
    let fileEnv: Readonly<Record<string, string | undefined>> = {}
    if (envFile !== undefined) {
        const text = await readIfExists(path.resolve(cwd, envFile), `env file ${envFile}`)
        if (text === undefined) throw new UsageError(`Env file ${envFile} does not exist.`)
        fileEnv = parseEnv(text)
    }
    return Object.fromEntries(
        [...Object.entries(fileEnv), ...Object.entries(env)].filter(
            (entry): entry is [string, string] => entry[1] !== undefined && entry[1] !== '',
        ),
    )
}

/** The path of the first key, at any depth, that names a credential. Never the credential itself. */
function findCredentialKey(value: unknown, prefix: string): string | undefined {
    if (typeof value !== 'object' || value === null) return undefined
    for (const [key, inner] of Object.entries(value)) {
        const keyPath = prefix === '' ? key : `${prefix}.${key}`
        if (isCredentialKey(key)) return keyPath
        const found = findCredentialKey(inner, keyPath)
        if (found !== undefined) return found
    }
    return undefined
}

function readString(raw: RawRecord, key: string, where: string): string | undefined {
    const value = raw[key]
    if (value === undefined) return undefined
    if (typeof value !== 'string' || value === '')
        throw new UsageError(`${where}: \`${key}\` must be a non-empty string.`)
    return value
}

function readStringList(raw: RawRecord, key: string, where: string): readonly string[] {
    const value = raw[key] ?? []
    if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || item === '')) {
        throw new UsageError(`${where}: \`${key}\` must be a list of non-empty strings.`)
    }
    return value as readonly string[]
}

function readRename(raw: RawRecord, where: string): Readonly<Record<string, string>> {
    const value = raw['rename'] ?? {}
    if (!isRecord(value) || Object.values(value).some((name) => typeof name !== 'string' || name === '')) {
        throw new UsageError(
            `${where}: \`rename\` must map DocType names to interface names, such as { "Item": "ErpItem" }.`,
        )
    }
    return value as Readonly<Record<string, string>>
}

/**
 * Parses a config file's text into its settings. Credentials are looked for before anything else, so
 * they are never reported as a mere unknown key. `where` names the file in messages; `out` is resolved
 * against `folder`, the file's folder.
 */
function parseConfigFile(text: string, where: string, folder: string): ConfigFile {
    let raw: unknown
    try {
        raw = JSON.parse(text)
    } catch (error) {
        throw new UsageError(`${where} is not valid JSON: ${(error as Error).message}`, { cause: error })
    }
    if (!isRecord(raw)) throw new UsageError(`${where} must hold a JSON object.`)
    // `rename`'s keys are DocType names, and a DocType may be called "API Token".
    const credentialKey = findCredentialKey({ ...raw, rename: undefined }, '')
    if (credentialKey !== undefined) {
        throw new UsageError(
            `${where} must not hold credentials (\`${credentialKey}\`): it is meant to be committed. ` +
                'Set FRAPPE_API_KEY and FRAPPE_API_SECRET in the environment or in a file passed with --env-file, ' +
                'and generate new API keys if the file was ever committed with them.',
        )
    }
    const unknownKey = Object.keys(raw).find((key) => !configFileKeys.includes(key))
    if (unknownKey !== undefined) {
        throw new UsageError(`${where}: unknown key \`${unknownKey}\`. Known keys: ${configFileKeys.join(', ')}.`)
    }
    const register = raw['register']
    if (register !== undefined && typeof register !== 'boolean') {
        throw new UsageError(`${where}: \`register\` must be true or false.`)
    }
    return {
        url: readString(raw, 'url', where),
        siteName: readString(raw, 'siteName', where),
        doctypes: readStringList(raw, 'doctypes', where),
        modules: readStringList(raw, 'modules', where),
        apps: readStringList(raw, 'apps', where),
        out: path.resolve(folder, readString(raw, 'out', where) ?? DEFAULT_OUT),
        register,
        rename: readRename(raw, where),
    }
}

/** `--config <file>`, which must exist, or `frappeforge.json` in the current folder when there is one. */
async function loadConfigFile(configFile: string | undefined, cwd: string): Promise<ConfigFile | undefined> {
    // The file as the user names it, for messages.
    const where = configFile ?? DEFAULT_CONFIG_FILE
    const file = path.resolve(cwd, where)
    const text = await readIfExists(file, `config file ${where}`)
    if (text === undefined) {
        if (configFile === undefined) return undefined
        throw new UsageError(`Config file ${configFile} does not exist.`)
    }
    return parseConfigFile(text, where, path.dirname(file))
}

/** The union of two lists, in order, without repeats. */
function union(first: readonly string[], second: readonly string[]): readonly string[] {
    return [...new Set([...first, ...second])]
}

/**
 * Merges the flags, the environment (with `--env-file`) and the config file into the settings of one
 * run, and checks that the site, the credentials and at least one DocType, module or app are given.
 *
 * @throws `UsageError` for anything the caller has to fix: an unreadable or invalid file, credentials
 * in the config file, or a missing setting.
 */
export async function resolveConfig(
    flags: Flags,
    io: { readonly env: Readonly<Record<string, string | undefined>>; readonly cwd: string },
): Promise<ResolvedConfig> {
    const env = await loadEnv(flags.envFile, io.env, io.cwd)
    const file = await loadConfigFile(flags.configFile, io.cwd)

    const url = flags.url ?? env['FRAPPE_URL'] ?? file?.url
    if (url === undefined) {
        throw new UsageError('No site URL: pass --url, set FRAPPE_URL, or set `url` in the config file.')
    }
    const apiKey = env['FRAPPE_API_KEY']
    const apiSecret = env['FRAPPE_API_SECRET']
    if (apiKey === undefined || apiSecret === undefined) {
        throw new UsageError(
            'Set FRAPPE_API_KEY and FRAPPE_API_SECRET in the environment or in a file passed with --env-file.',
        )
    }
    const doctypes = union(file?.doctypes ?? [], flags.doctypes)
    const modules = union(file?.modules ?? [], flags.modules)
    const apps = union(file?.apps ?? [], flags.apps)
    if (doctypes.length + modules.length + apps.length === 0) {
        throw new UsageError(
            'Nothing to generate: select DocTypes with --doctype, --module or --app, or with `doctypes`, `modules` or `apps` in the config file.',
        )
    }
    return {
        url,
        siteName: flags.siteName ?? env['FRAPPE_SITE_NAME'] ?? file?.siteName,
        apiKey,
        apiSecret,
        doctypes,
        modules,
        apps,
        out:
            flags.out === undefined
                ? (file?.out ?? path.resolve(io.cwd, DEFAULT_OUT))
                : path.resolve(io.cwd, flags.out),
        register: flags.register ?? file?.register ?? true,
        rename: file?.rename ?? {},
    }
}
