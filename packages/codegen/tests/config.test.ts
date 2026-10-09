import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { DEFAULT_OUT, resolveConfig, type ResolvedConfig, UsageError } from '../src/config.js'
import { parseFlags } from '../src/flags.js'
import { tempDir } from './support/temp-dir.js'

const credentials = { FRAPPE_API_KEY: 'key', FRAPPE_API_SECRET: 'secret' }

/** Resolves a command line in `cwd`, with the credentials in the environment unless `env` says otherwise. */
function resolveCommandLine(
    argv: readonly string[],
    cwd: string,
    env: Readonly<Record<string, string | undefined>> = credentials,
): Promise<ResolvedConfig> {
    return resolveConfig(parseFlags(argv), { env, cwd })
}

describe('resolveConfig', () => {
    it('resolves flags alone, with the defaults', async () => {
        const cwd = await tempDir()

        await expect(
            resolveCommandLine(['--url', 'https://example.com', '--doctype', 'ToDo'], cwd),
        ).resolves.toStrictEqual({
            url: 'https://example.com',
            siteName: undefined,
            apiKey: 'key',
            apiSecret: 'secret',
            doctypes: ['ToDo'],
            modules: [],
            apps: [],
            out: path.join(cwd, DEFAULT_OUT),
            register: true,
            rename: {},
        })
    })

    it('reads every setting from frappeforge.json in the current folder', async () => {
        const cwd = await tempDir({
            'frappeforge.json': JSON.stringify({
                $schema: './node_modules/@frappeforge/codegen/schema.json',
                url: 'https://example.com',
                siteName: 'site1.local',
                doctypes: ['Customer'],
                modules: ['Selling'],
                apps: ['erpnext'],
                out: 'types/frappe.ts',
                register: false,
                rename: { Item: 'ErpItem' },
            }),
        })

        await expect(resolveCommandLine([], cwd)).resolves.toStrictEqual({
            url: 'https://example.com',
            siteName: 'site1.local',
            apiKey: 'key',
            apiSecret: 'secret',
            doctypes: ['Customer'],
            modules: ['Selling'],
            apps: ['erpnext'],
            out: path.join(cwd, 'types/frappe.ts'),
            register: false,
            rename: { Item: 'ErpItem' },
        })
    })

    it('prefers flags to the environment, and the environment to the file', async () => {
        const cwd = await tempDir({
            'frappeforge.json': JSON.stringify({
                url: 'https://file.example.com',
                siteName: 'file.local',
                doctypes: ['ToDo'],
            }),
        })
        const env = { ...credentials, FRAPPE_URL: 'https://env.example.com', FRAPPE_SITE_NAME: 'env.local' }

        const fromFile = await resolveCommandLine([], cwd, credentials)
        const fromEnv = await resolveCommandLine([], cwd, env)
        const fromFlags = await resolveCommandLine(
            ['--url', 'https://example.com', '--site-name', 'site1.local'],
            cwd,
            env,
        )

        expect([fromFile.url, fromFile.siteName]).toStrictEqual(['https://file.example.com', 'file.local'])
        expect([fromEnv.url, fromEnv.siteName]).toStrictEqual(['https://env.example.com', 'env.local'])
        expect([fromFlags.url, fromFlags.siteName]).toStrictEqual(['https://example.com', 'site1.local'])
    })

    it('lets a flag turn registration back on', async () => {
        const cwd = await tempDir({
            'frappeforge.json': JSON.stringify({ url: 'https://example.com', doctypes: ['ToDo'], register: false }),
        })

        await expect(resolveCommandLine(['--register'], cwd)).resolves.toMatchObject({ register: true })
        await expect(resolveCommandLine([], cwd)).resolves.toMatchObject({ register: false })
    })

    it('combines the lists of the file and the flags, without repeats', async () => {
        const cwd = await tempDir({
            'frappeforge.json': JSON.stringify({
                url: 'https://example.com',
                doctypes: ['Customer', 'Item'],
                modules: ['Selling'],
                apps: ['erpnext'],
            }),
        })

        await expect(
            resolveCommandLine(['-d', 'ToDo', '-d', 'Item', '-m', 'Stock', '-m', 'Selling', '--app', 'hrms'], cwd),
        ).resolves.toMatchObject({
            doctypes: ['Customer', 'Item', 'ToDo'],
            modules: ['Selling', 'Stock'],
            apps: ['erpnext', 'hrms'],
        })
    })

    it('resolves the output file of the config file against its folder, and --out against the current one', async () => {
        const cwd = await tempDir({
            'web/frappeforge.json': JSON.stringify({
                url: 'https://example.com',
                doctypes: ['ToDo'],
                out: 'src/types.ts',
            }),
            'api/frappeforge.json': JSON.stringify({ url: 'https://example.com', doctypes: ['ToDo'] }),
        })

        await expect(resolveCommandLine(['-c', 'web/frappeforge.json'], cwd)).resolves.toMatchObject({
            out: path.join(cwd, 'web/src/types.ts'),
        })
        await expect(resolveCommandLine(['-c', 'api/frappeforge.json'], cwd)).resolves.toMatchObject({
            out: path.join(cwd, 'api', DEFAULT_OUT),
        })
        await expect(resolveCommandLine(['-c', 'web/frappeforge.json', '-o', 'out.ts'], cwd)).resolves.toMatchObject({
            out: path.join(cwd, 'out.ts'),
        })
    })

    describe('--env-file', () => {
        it('reads the site and the credentials from the file', async () => {
            const cwd = await tempDir({
                '.env': [
                    '# Written by hand',
                    'FRAPPE_URL=https://example.com',
                    'FRAPPE_SITE_NAME=site1.local',
                    'FRAPPE_API_KEY=file-key',
                    'export FRAPPE_API_SECRET="file-secret"',
                ].join('\n'),
            })

            await expect(resolveCommandLine(['--env-file', '.env', '-d', 'ToDo'], cwd, {})).resolves.toMatchObject({
                url: 'https://example.com',
                siteName: 'site1.local',
                apiKey: 'file-key',
                apiSecret: 'file-secret',
            })
        })

        it('lets the environment win, unless its value is empty', async () => {
            const cwd = await tempDir({
                '.env': 'FRAPPE_URL=https://file.example.com\nFRAPPE_API_KEY=file-key\nFRAPPE_API_SECRET=file-secret',
            })
            const env = { FRAPPE_URL: 'https://example.com', FRAPPE_API_KEY: '', FRAPPE_API_SECRET: 'secret' }

            await expect(resolveCommandLine(['--env-file', '.env', '-d', 'ToDo'], cwd, env)).resolves.toMatchObject({
                url: 'https://example.com',
                apiKey: 'file-key',
                apiSecret: 'secret',
            })
        })

        it('is a usage error when the file does not exist or cannot be read', async () => {
            const cwd = await tempDir({ 'folder/file': '' })

            await expect(resolveCommandLine(['--env-file', '.env', '-d', 'ToDo'], cwd)).rejects.toThrow(
                new UsageError('Env file .env does not exist.'),
            )
            await expect(resolveCommandLine(['--env-file', 'folder', '-d', 'ToDo'], cwd)).rejects.toThrow(
                /^Cannot read env file folder: EISDIR/u,
            )
        })
    })

    describe('the config file', () => {
        it('is optional when not named', async () => {
            const cwd = await tempDir()

            await expect(resolveCommandLine(['-u', 'https://example.com', '-d', 'ToDo'], cwd)).resolves.toMatchObject({
                url: 'https://example.com',
            })
        })

        it('must exist when named', async () => {
            const cwd = await tempDir()

            await expect(resolveCommandLine(['-c', 'codegen.json', '-d', 'ToDo'], cwd)).rejects.toThrow(
                new UsageError('Config file codegen.json does not exist.'),
            )
        })

        it.each([
            ['not JSON', '{ "url": "https://example.com", }', /^frappeforge\.json is not valid JSON: /u],
            ['not an object', '["ToDo"]', /^frappeforge\.json must hold a JSON object\.$/u],
            [
                'an unknown key',
                JSON.stringify({ doctype: ['ToDo'] }),
                'frappeforge.json: unknown key `doctype`. Known keys: $schema, url, siteName, doctypes, modules, apps, out, register, rename.',
            ],
            ['an empty url', JSON.stringify({ url: '' }), 'frappeforge.json: `url` must be a non-empty string.'],
            ['a numeric siteName', JSON.stringify({ siteName: 1 }), '`siteName` must be a non-empty string.'],
            ['a string list', JSON.stringify({ doctypes: 'ToDo' }), '`doctypes` must be a list of non-empty strings.'],
            ['an empty name', JSON.stringify({ modules: [''] }), '`modules` must be a list of non-empty strings.'],
            ['a non-string name', JSON.stringify({ apps: [1] }), '`apps` must be a list of non-empty strings.'],
            ['a null out', JSON.stringify({ out: null }), '`out` must be a non-empty string.'],
            ['a string register', JSON.stringify({ register: 'no' }), '`register` must be true or false.'],
            [
                'a list rename',
                JSON.stringify({ rename: ['Item'] }),
                '`rename` must map DocType names to interface names',
            ],
            ['an empty interface name', JSON.stringify({ rename: { Item: '' } }), '`rename` must map DocType names'],
        ])('rejects %s', async (_case, text, message) => {
            const cwd = await tempDir({ 'frappeforge.json': text })

            const error = await resolveCommandLine(['-d', 'ToDo'], cwd).catch((thrown: unknown) => thrown)

            expect(error).toBeInstanceOf(UsageError)
            expect((error as Error).message).toMatch(message)
        })

        it('is a usage error when it cannot be read', async () => {
            const cwd = await tempDir({ 'frappeforge.json/file': '' })

            await expect(resolveCommandLine(['-d', 'ToDo'], cwd)).rejects.toThrow(
                /^Cannot read config file frappeforge\.json: EISDIR/u,
            )
        })
    })

    describe('credentials in the config file', () => {
        it.each([
            [{ apiKey: 'key' }, 'apiKey'],
            [{ apiSecret: 'secret' }, 'apiSecret'],
            [{ api_key: 'key' }, 'api_key'],
            [{ FRAPPE_API_SECRET: 'secret' }, 'FRAPPE_API_SECRET'],
            [{ password: 'admin' }, 'password'],
            [{ apiToken: 'x' }, 'apiToken'],
            [{ accessToken: 'x' }, 'accessToken'],
            [{ auth: { key: 'key' } }, 'auth'],
            [{ Authorization: 'token key:secret' }, 'Authorization'],
            [{ servers: [{ Secret: 'x' }] }, 'servers.0.Secret'],
            [{ servers: [{ credentials: {} }] }, 'servers.0.credentials'],
        ])('rejects %j, naming the key but not the value', async (config, keyPath) => {
            const cwd = await tempDir({
                'frappeforge.json': JSON.stringify({ url: 'https://example.com', doctypes: ['ToDo'], ...config }),
            })

            const error = await resolveCommandLine([], cwd).catch((thrown: unknown) => thrown)

            expect(error).toBeInstanceOf(UsageError)
            expect((error as Error).message).toBe(
                `frappeforge.json must not hold credentials (\`${keyPath}\`): it is meant to be committed. ` +
                    'Set FRAPPE_API_KEY and FRAPPE_API_SECRET in the environment or in a file passed with --env-file, ' +
                    'and generate new API keys if the file was ever committed with them.',
            )
        })

        it('allows a DocType named like a credential in rename', async () => {
            const cwd = await tempDir({
                'frappeforge.json': JSON.stringify({
                    url: 'https://example.com',
                    doctypes: ['Token'],
                    rename: { Token: 'AppToken', 'API Token': 'ApiToken' },
                }),
            })

            await expect(resolveCommandLine([], cwd)).resolves.toMatchObject({
                rename: { Token: 'AppToken', 'API Token': 'ApiToken' },
            })
        })
    })

    describe('missing settings', () => {
        it('needs a site URL', async () => {
            const cwd = await tempDir()

            await expect(resolveCommandLine(['-d', 'ToDo'], cwd)).rejects.toThrow(
                new UsageError('No site URL: pass --url, set FRAPPE_URL, or set `url` in the config file.'),
            )
        })

        it.each([[{}], [{ FRAPPE_API_KEY: 'key' }], [{ FRAPPE_API_SECRET: 'secret' }]])(
            'needs both credentials, given %j',
            async (env) => {
                const cwd = await tempDir()

                await expect(resolveCommandLine(['-u', 'https://example.com', '-d', 'ToDo'], cwd, env)).rejects.toThrow(
                    new UsageError(
                        'Set FRAPPE_API_KEY and FRAPPE_API_SECRET in the environment or in a file passed with --env-file.',
                    ),
                )
            },
        )

        it('needs something to generate', async () => {
            const cwd = await tempDir()

            await expect(resolveCommandLine(['-u', 'https://example.com'], cwd)).rejects.toThrow(
                new UsageError(
                    'Nothing to generate: select DocTypes with --doctype, --module or --app, or with `doctypes`, `modules` or `apps` in the config file.',
                ),
            )
        })
    })
})
