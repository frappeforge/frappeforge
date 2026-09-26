import { describe, expect, it } from 'vitest'

import { parseSetCookie, serializeCookies } from '../../src/auth/cookies.js'

const now = Date.parse('Fri, 25 Sep 2026 12:00:00 GMT')
const past = 'Thu, 24 Sep 2026 10:00:00 GMT'
const future = 'Tue, 29 Sep 2026 10:00:00 GMT'

describe('parseSetCookie: name and value', () => {
    it.each([
        [
            'every attribute is ignored',
            'sid=abc; Path=/; HttpOnly; Secure; SameSite=Lax; Domain=example.com; Partitioned',
            'sid',
            'abc',
        ],
        ['splits at the first "="', 'token=a=b==', 'token', 'a=b=='],
        ['keeps double quotes, to send the value back as received', 'full_name="John Doe"', 'full_name', '"John Doe"'],
        ['keeps percent-encoding', 'full_name=John%20Doe; Path=/', 'full_name', 'John%20Doe'],
        ['trims spaces and tabs around the name and the value', ' \tsid  =  abc \t; path=/', 'sid', 'abc'],
        ['keeps an empty value', 'user_image=; Path=/', 'user_image', ''],
    ])('%s', (_title, header, name, value) => {
        expect(parseSetCookie(header, now)).toEqual({ name, value, expired: false })
    })

    it.each([
        ['no "="', 'novalue; Path=/'],
        ['an empty name', '=abc'],
        ['a name of whitespace only', ' \t=abc'],
        ['an empty header', ''],
    ])('ignores a header with %s', (_title, header) => {
        expect(parseSetCookie(header, now)).toBeUndefined()
    })
})

describe('parseSetCookie: expiry', () => {
    it.each([
        ['Max-Age=0', 'sid=; Max-Age=0'],
        ['a negative Max-Age', 'sid=; Max-Age=-1'],
        ['Max-Age in any case, with spaces', 'sid=;  max-age = 0 '],
        ['a past Expires, without Max-Age (how Frappe deletes)', `sid=; Expires=${past}; Path=/`],
        ['the Netscape date form', 'sid=; expires=Thu, 01-Jan-1970 00:00:00 GMT'],
        ['the RFC 850 date form', 'sid=; Expires=Thursday, 24-Sep-26 10:00:00 GMT'],
        ['an Expires of exactly now', `sid=; Expires=${new Date(now).toUTCString()}`],
        ['Max-Age=0 even with a future Expires', `sid=; Max-Age=0; Expires=${future}`],
        ['Max-Age=0 even when Expires comes first', `sid=; Expires=${future}; Max-Age=0`],
        ['the last Max-Age', 'sid=; Max-Age=60; Max-Age=0'],
    ])('expires with %s', (_title, header) => {
        expect(parseSetCookie(header, now)?.expired).toBe(true)
    })

    it.each([
        ['no Max-Age or Expires (a session cookie)', 'sid=abc; Path=/'],
        ['a positive Max-Age', 'sid=abc; Max-Age=345600'],
        ['a future Expires', `sid=abc; Expires=${future}`],
        ['a positive Max-Age even with a past Expires', `sid=abc; Max-Age=3600; Expires=${past}`],
        ['the last Max-Age', 'sid=abc; Max-Age=0; Max-Age=60'],
        ['Max-Age=abc (ignored)', 'sid=abc; Max-Age=abc'],
        ['Max-Age=1.5 (ignored)', 'sid=abc; Max-Age=1.5'],
        ['Max-Age=+5 (ignored)', 'sid=abc; Max-Age=+5'],
        ['an empty Max-Age (ignored)', 'sid=abc; Max-Age='],
        ['Max-Age without "=" (ignored)', 'sid=abc; Max-Age'],
        ['Expires=0, which Date.parse would read as the year 2000 (ignored)', 'sid=abc; Expires=0'],
        ['an Expires that is not a date (ignored)', 'sid=abc; Expires=garbage'],
        ['a day name and GMT around an invalid date (ignored)', 'sid=abc; Expires=Thu, 99 Foo 2026 GMT'],
        [
            'an asctime date, which Date.parse reads as local time (ignored)',
            'sid=abc; Expires=Thu Sep 24 10:00:00 2026',
        ],
        ['empty attributes', 'sid=abc;;; ;'],
    ])('keeps a cookie with %s', (_title, header) => {
        expect(parseSetCookie(header, now)).toEqual({ name: 'sid', value: 'abc', expired: false })
    })
})

describe('serializeCookies', () => {
    it('joins name=value pairs in insertion order', () => {
        const jar = new Map([
            ['sid', 'abc'],
            ['full_name', 'John%20Doe'],
            ['user_image', ''],
        ])
        expect(serializeCookies(jar)).toBe('sid=abc; full_name=John%20Doe; user_image=')
    })

    it('is empty for an empty jar', () => {
        expect(serializeCookies(new Map())).toBe('')
    })
})
