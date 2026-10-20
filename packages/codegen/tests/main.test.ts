import { readFile, stat, utimes } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it, vi } from 'vitest'

import { usage } from '../src/flags.js'
import { generate, type GenerateOptions } from '../src/generate.js'
import { VERSION } from '../src/index.js'
import { type IO, main } from '../src/main.js'
import { normalizeDocType } from '../src/meta.js'
import { docTypeRecord, frappeError, recordedBundles, stubSite, type StubSiteOptions } from './support/site.js'
import { tempDir } from './support/temp-dir.js'

const credentials = { FRAPPE_API_KEY: 'key', FRAPPE_API_SECRET: 'secret' }
const bundles = recordedBundles('v15')
const urlFlag = ['--url', 'https://example.com']

/** What the command generates for these recorded DocTypes. */
function expectedCode(doctypes: readonly string[], options?: GenerateOptions): string {
    return generate(
        doctypes.flatMap((doctype) => (bundles[doctype] ?? []).map(normalizeDocType)),
        options,
    ).code
}

/** Runs the command in `cwd` against a stub site holding the recorded DocTypes. */
async function run(
    argv: readonly string[],
    cwd: string,
    { env = credentials, site = {} }: { env?: IO['env']; site?: StubSiteOptions } = {},
) {
    const stub = stubSite({ bundles, ...site })
    let stdout = ''
    let stderr = ''
    const io: IO = {
        env,
        cwd,
        stdout: { write: (text: string) => (stdout += text) },
        stderr: { write: (text: string) => (stderr += text) },
        fetch: stub.fetch,
    }
    const code = await main(argv, io)
    return { code, stdout, stderr, requests: stub.requests }
}

describe('main', () => {
    it.each([[['--help']], [['-h']], [['--version', '--help']]])(
        'prints the usage for %j, reading nothing',
        async (argv) => {
            const cwd = await tempDir({ 'frappeforge.json': 'not JSON' })

            await expect(run(argv, cwd, { env: {} })).resolves.toStrictEqual({
                code: 0,
                stdout: usage,
                stderr: '',
                requests: [],
            })
        },
    )

    it.each([['--version'], ['-v']])('prints the version for %s', async (flag) => {
        const cwd = await tempDir()

        await expect(run([flag], cwd, { env: {} })).resolves.toMatchObject({ code: 0, stdout: `${VERSION}\n` })
    })

    it('writes the module, creating its folder, and says what it generated', async () => {
        const cwd = await tempDir()

        const result = await run([...urlFlag, '-d', 'ToDo', '-d', 'FF Counter'], cwd)

        expect(result).toStrictEqual({
            code: 0,
            stdout: `Generated 2 DocTypes → ${path.join('src', 'frappe.generated.ts')}\n`,
            stderr: '',
            requests: expect.any(Array) as unknown,
        })
        await expect(readFile(path.join(cwd, 'src/frappe.generated.ts'), 'utf8')).resolves.toBe(
            expectedCode(['ToDo', 'FF Counter']),
        )
    })

    it('counts the child tables', async () => {
        const cwd = await tempDir()
        const parent = docTypeRecord('FF Parent', {
            fields: [{ fieldname: 'items', fieldtype: 'Table', options: 'FF Parent Item' }],
        })
        const site = { bundles: { 'FF Parent': [parent, docTypeRecord('FF Parent Item', { istable: 1 })] } }

        const oneTable = await run([...urlFlag, '-d', 'FF Parent', '-o', 'one.ts'], cwd, { site })
        const sixTables = await run([...urlFlag, '-d', 'Sales Order', '-d', 'ToDo', '-o', 'many.ts'], cwd)
        const noTables = await run([...urlFlag, '-d', 'ToDo', '-o', 'single.ts'], cwd)

        expect(oneTable.stdout).toBe('Generated 2 DocTypes (1 child table) → one.ts\n')
        expect(sixTables.stdout).toBe('Generated 8 DocTypes (6 child tables) → many.ts\n')
        expect(noTables.stdout).toBe('Generated 1 DocType → single.ts\n')
    })

    it('takes its settings from the config file, and prints the warnings', async () => {
        const cwd = await tempDir({
            'frappeforge.json': JSON.stringify({
                url: 'https://example.com',
                doctypes: ['ToDo'],
                out: 'types/frappe.ts',
                register: false,
                rename: { ToDo: 'Task', Itme: 'ErpItem' },
            }),
        })

        const result = await run([], cwd)

        expect(result.code).toBe(0)
        expect(result.stderr).toBe(
            "Warning: rename: DocType 'Itme' is not generated, so 'ErpItem' is not used. Check the DocType's name.\n",
        )
        await expect(readFile(path.join(cwd, 'types/frappe.ts'), 'utf8')).resolves.toBe(
            expectedCode(['ToDo'], { register: false, rename: { ToDo: 'Task', Itme: 'ErpItem' } }),
        )
    })

    it('prints the warning for a DocType the site cannot load, and generates the rest', async () => {
        const cwd = await tempDir()
        const site: StubSiteOptions = {
            docTypeRows: [
                { name: 'ToDo', module: 'Desk', istable: 0 },
                { name: 'FF Counter', module: 'Custom', istable: 0 },
            ],
            intercept: (request) =>
                request.url.includes('doctype=ToDo') ? frappeError(417, 'ValidationError') : undefined,
        }

        const result = await run([...urlFlag, '-m', 'Desk', '-m', 'Custom', '-o', 'frappe.ts'], cwd, { site })

        expect(result.code).toBe(0)
        expect(result.stderr).toMatch(
            /^Warning: DocType 'ToDo': https:\/\/example\.com cannot load its metadata, so it is not generated\. .+\n$/u,
        )
        expect(result.stdout).toBe('Generated 1 DocType → frappe.ts\n')
    })

    it('prints the warnings of the site before an error of the generator', async () => {
        const cwd = await tempDir()
        const site: StubSiteOptions = {
            docTypeRows: [{ name: 'ToDo', module: 'Desk', istable: 0 }],
            intercept: (request) =>
                request.url.includes('getdoctype')
                    ? frappeError(404, 'DoesNotExistError', 'DocType X not found')
                    : undefined,
        }

        const result = await run([...urlFlag, '-m', 'Desk'], cwd, { site })

        expect(result.code).toBe(1)
        expect(result.stderr).toBe(
            "Warning: DocType 'ToDo': https://example.com cannot load its metadata, so it is not generated. DocType X not found\n" +
                'Error: There are no DocTypes to generate.\n',
        )
    })

    it('sends the site name, and uses the global fetch when given none', async () => {
        const cwd = await tempDir()
        const stub = stubSite({
            bundles,
            intercept: (request) => {
                expect(request.headers.get('x-frappe-site-name')).toBe('site1.local')
                return undefined
            },
        })
        vi.stubGlobal('fetch', stub.fetch)
        const io: IO = { env: credentials, cwd, stdout: { write: () => true }, stderr: { write: () => true } }

        await expect(main([...urlFlag, '--site-name', 'site1.local', '-d', 'ToDo'], io)).resolves.toBe(0)
        expect(stub.requests).toHaveLength(1)
    })

    it('leaves an unchanged module untouched', async () => {
        const cwd = await tempDir({ 'frappe.ts': expectedCode(['ToDo']) })
        const file = path.join(cwd, 'frappe.ts')
        const past = new Date('2026-01-01T00:00:00Z')
        await utimes(file, past, past)

        const result = await run([...urlFlag, '-d', 'ToDo', '-o', 'frappe.ts'], cwd)

        expect(result.stdout).toBe('Generated 1 DocType → frappe.ts (unchanged)\n')
        expect((await stat(file)).mtime).toStrictEqual(past)
    })

    it('replaces a changed module', async () => {
        const cwd = await tempDir({ 'frappe.ts': 'old' })

        const result = await run([...urlFlag, '-d', 'ToDo', '-o', 'frappe.ts'], cwd)

        expect(result.stdout).toBe('Generated 1 DocType → frappe.ts\n')
        await expect(readFile(path.join(cwd, 'frappe.ts'), 'utf8')).resolves.toBe(expectedCode(['ToDo']))
    })

    describe('--check', () => {
        it('passes when the module is up to date, also with CRLF line endings', async () => {
            const cwd = await tempDir({
                'lf.ts': expectedCode(['ToDo']),
                'crlf.ts': expectedCode(['ToDo']).replaceAll('\n', '\r\n'),
            })

            const lf = await run([...urlFlag, '-d', 'ToDo', '-o', 'lf.ts', '--check'], cwd)
            const crlf = await run([...urlFlag, '-d', 'ToDo', '-o', 'crlf.ts', '--check'], cwd)

            expect([lf.code, lf.stdout, lf.stderr]).toStrictEqual([0, 'lf.ts is up to date.\n', ''])
            expect([crlf.code, crlf.stdout]).toStrictEqual([0, 'crlf.ts is up to date.\n'])
        })

        it('fails when the module is out of date, and writes nothing', async () => {
            const cwd = await tempDir({ 'frappe.ts': 'old' })

            const result = await run([...urlFlag, '-d', 'ToDo', '-o', 'frappe.ts', '--check'], cwd)

            expect([result.code, result.stdout, result.stderr]).toStrictEqual([
                1,
                '',
                'frappe.ts is out of date. Run the same command without --check.\n',
            ])
            await expect(readFile(path.join(cwd, 'frappe.ts'), 'utf8')).resolves.toBe('old')
        })

        it('fails when the module does not exist, and creates nothing', async () => {
            const cwd = await tempDir()

            const result = await run([...urlFlag, '-d', 'ToDo', '-o', 'frappe.ts', '--check'], cwd)

            expect([result.code, result.stderr]).toStrictEqual([
                1,
                'frappe.ts does not exist. Run the same command without --check.\n',
            ])
            await expect(stat(path.join(cwd, 'frappe.ts'))).rejects.toThrow('ENOENT')
        })
    })

    describe('from a bench', () => {
        const v15Bench = fileURLToPath(new URL('fixtures/bench/v15/', import.meta.url))
        const noNetwork = (): never => {
            throw new Error('No request may be sent.')
        }

        it('reads the bench it runs in, with no site, credentials or network', async () => {
            vi.stubGlobal('fetch', noNetwork)
            const out = path.join(await tempDir(), 'frappe.ts')
            const cwd = path.join(v15Bench, 'apps/frappe/frappe')
            let stdout = ''
            const io: IO = {
                env: {},
                cwd,
                stdout: { write: (text: string) => (stdout += text) },
                stderr: { write: noNetwork },
                fetch: noNetwork,
            }

            const code = await main(['--doctype', 'ToDo', '--out', out], io)
            const checked = await main(['--doctype', 'ToDo', '--out', out, '--check'], io)
            vi.unstubAllGlobals()

            expect([code, checked]).toStrictEqual([0, 0])
            expect(stdout).toBe(
                `Generated 1 DocType → ${path.relative(cwd, out)}\n${path.relative(cwd, out)} is up to date.\n`,
            )
            await expect(readFile(out, 'utf8')).resolves.toBe(expectedCode(['ToDo']))
        })

        it('fails for a DocType the bench does not have', async () => {
            const result = await run(['--doctype', 'Customer', '--out', 'unused.ts'], v15Bench, { env: {} })

            expect([result.code, result.stderr]).toStrictEqual([
                1,
                "Error: DocType 'Customer' is in none of the bench's apps (frappe): check its name.\n",
            ])
        })
    })

    describe('errors', () => {
        it.each([
            [['--bogus'], "Unknown option '--bogus'"],
            [['--url', 'https://example.com'], 'Nothing to generate'],
            [['--doctype', 'ToDo'], 'No site and no bench'],
            [['--url', 'ftp://example.com', '-d', 'ToDo'], '`url` must be an http(s) URL'],
        ])('answers %j with a usage error', async (argv, message) => {
            const cwd = await tempDir()

            const result = await run(argv, cwd)

            expect(result.code).toBe(2)
            expect(result.stderr).toMatch(/^Error: .+\nRun frappeforge-codegen --help for usage\.\n$/u)
            expect(result.stderr).toContain(message)
            expect(result.requests).toStrictEqual([])
        })

        it.each([[{ ...credentials, FRAPPE_API_KEY: 'key ' }], [{ ...credentials, FRAPPE_API_SECRET: 'a:b' }]])(
            'names the environment variables for a malformed credential in %j',
            async (env) => {
                const cwd = await tempDir()

                const result = await run([...urlFlag, '-d', 'ToDo'], cwd, { env })

                expect([result.code, result.stderr, result.requests]).toStrictEqual([
                    2,
                    'Error: FRAPPE_API_KEY and FRAPPE_API_SECRET must be visible ASCII characters without ":". ' +
                        'Check them for a stray space or line break.\nRun frappeforge-codegen --help for usage.\n',
                    [],
                ])
            },
        )

        it('explains rejected credentials', async () => {
            const cwd = await tempDir()

            const result = await run([...urlFlag, '-d', 'ToDo'], cwd, {
                site: { intercept: () => frappeError(401, 'AuthenticationError') },
            })

            expect(result.code).toBe(1)
            expect(result.stderr).toMatch(
                /^Error: https:\/\/example\.com rejected FRAPPE_API_KEY and FRAPPE_API_SECRET\. Check both; generating new keys for a user replaces the secret\.\n {2}Cause: .+\n$/u,
            )
        })

        it('leaves out a cause that the message already says', async () => {
            const cwd = await tempDir()

            const result = await run([...urlFlag, '-d', 'Custmer'], cwd)

            expect([result.code, result.stderr]).toStrictEqual([
                1,
                "Error: Cannot read DocType 'Custmer' on https://example.com: DocType Custmer not found\n",
            ])
        })

        it('fails when the module cannot be generated', async () => {
            const cwd = await tempDir({
                'frappeforge.json': JSON.stringify({ rename: { ToDo: 'FFCounter' } }),
            })

            const result = await run([...urlFlag, '-d', 'ToDo', '-d', 'FF Counter'], cwd)

            expect(result.code).toBe(1)
            expect(result.stderr).toMatch(/^Error: .*FFCounter/u)
        })

        it('is a usage error when the output file cannot be read', async () => {
            const cwd = await tempDir({ 'taken/file': '' })

            const result = await run([...urlFlag, '-d', 'ToDo', '-o', 'taken'], cwd)

            expect(result.code).toBe(2)
            expect(result.stderr).toMatch(/^Error: Cannot read output file taken: EISDIR/u)
        })
    })
})
