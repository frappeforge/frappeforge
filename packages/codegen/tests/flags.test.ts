import { describe, expect, it } from 'vitest'

import { DEFAULT_OUT, UsageError } from '../src/config.js'
import { type Flags, options, parseFlags, usage } from '../src/flags.js'

const noFlags: Flags = {
    configFile: undefined,
    url: undefined,
    siteName: undefined,
    doctypes: [],
    modules: [],
    apps: [],
    out: undefined,
    register: undefined,
    check: false,
    envFile: undefined,
    help: false,
    version: false,
}

describe('parseFlags', () => {
    it('leaves every option unset without arguments', () => {
        expect(parseFlags([])).toStrictEqual(noFlags)
    })

    it('reads every option by its long name', () => {
        expect(
            parseFlags([
                '--config',
                'codegen.json',
                '--url',
                'https://example.com',
                '--site-name',
                'site1.local',
                '--doctype',
                'ToDo',
                '--module',
                'Selling',
                '--app',
                'erpnext',
                '--out',
                'types.ts',
                '--no-register',
                '--check',
                '--env-file',
                '.env',
                '--help',
                '--version',
            ]),
        ).toStrictEqual({
            configFile: 'codegen.json',
            url: 'https://example.com',
            siteName: 'site1.local',
            doctypes: ['ToDo'],
            modules: ['Selling'],
            apps: ['erpnext'],
            out: 'types.ts',
            register: false,
            check: true,
            envFile: '.env',
            help: true,
            version: true,
        })
    })

    it('reads the short names', () => {
        expect(
            parseFlags([
                '-c',
                'a.json',
                '-u',
                'https://example.com',
                '-d',
                'ToDo',
                '-m',
                'Desk',
                '-o',
                'x.ts',
                '-h',
                '-v',
            ]),
        ).toStrictEqual({
            ...noFlags,
            configFile: 'a.json',
            url: 'https://example.com',
            doctypes: ['ToDo'],
            modules: ['Desk'],
            out: 'x.ts',
            help: true,
            version: true,
        })
    })

    it('collects repeated DocTypes, modules and apps in order', () => {
        const flags = parseFlags([
            '-d',
            'ToDo',
            '--doctype=FF Counter',
            '-dNote',
            '-m',
            'Selling',
            '--module',
            'Stock',
            '--app',
            'frappe',
            '--app',
            'erpnext',
        ])

        expect(flags.doctypes).toStrictEqual(['ToDo', 'FF Counter', 'Note'])
        expect(flags.modules).toStrictEqual(['Selling', 'Stock'])
        expect(flags.apps).toStrictEqual(['frappe', 'erpnext'])
    })

    it('turns registration on or off, the last flag winning', () => {
        expect(parseFlags(['--register']).register).toBe(true)
        expect(parseFlags(['--no-register']).register).toBe(false)
        expect(parseFlags(['--no-register', '--register']).register).toBe(true)
    })

    it.each([
        [['--bogus'], "Unknown option '--bogus'"],
        [['--no-url'], "Unknown option '--no-url'"],
        [['--url'], 'argument missing'],
        [['--check=yes'], "Option '--check' does not take an argument"],
        [['ToDo'], "Unexpected argument 'ToDo'"],
    ])('rejects %j as a usage error', (argv, message) => {
        expect(() => parseFlags(argv)).toThrow(UsageError)
        expect(() => parseFlags(argv)).toThrow(message)
    })

    it.each([
        [['--url='], '--url needs a value.'],
        [['--doctype', 'ToDo', '--doctype', ''], '--doctype needs a value.'],
        [['--env-file='], '--env-file needs a value.'],
    ])('rejects an empty value in %j', (argv, message) => {
        expect(() => parseFlags(argv)).toThrow(new UsageError(message))
    })
})

describe('usage', () => {
    it('describes every option and the default output file', () => {
        // A boolean that is on by default is shown as its negation, such as `--no-register`.
        for (const name of Object.keys(options)) expect(usage).toMatch(new RegExp(`--(?:no-)?${name} `, 'u'))
        expect(usage).toContain(`(default: ${DEFAULT_OUT})`)
    })
})
