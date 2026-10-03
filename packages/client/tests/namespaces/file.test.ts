import { describe, expect, it } from 'vitest'

import {
    createClient,
    FrappeError,
    InvalidArgumentError,
    PermissionError,
    type UploadOptions,
} from '../../src/index.js'
import { json, only, type Reply, stubFetch } from '../support/fetch.js'

const url = 'https://example.com'
const UPLOAD = `${url}/api/method/frappe.handler.upload_file`

function client(replies: Reply[] = []) {
    const { fetch, requests } = stubFetch(replies)
    return { frappe: createClient({ url, fetch }), requests }
}

const stored = {
    doctype: 'File',
    name: 'a1b2c3',
    file_name: 'invoice.pdf',
    file_url: '/private/files/invoice.pdf',
    is_private: 1,
}

/** The multipart form the request carries, as Frappe would read it. */
async function formOf(request: Request): Promise<Record<string, FormDataEntryValue>> {
    return Object.fromEntries(await request.formData())
}

async function uploaded(file: Blob, options?: UploadOptions): Promise<Request> {
    const { frappe, requests } = client([json(200, { message: stored })])
    await expect(frappe.file.upload(file, options)).resolves.toEqual(stored)
    return only(requests)
}

describe('file.upload', () => {
    it('posts a private multipart upload and returns the File document', async () => {
        const request = await uploaded(new File(['%PDF'], 'invoice.pdf', { type: 'application/pdf' }))
        expect(request.method).toBe('POST')
        expect(request.url).toBe(UPLOAD)
        expect(request.headers.get('content-type')).toMatch(/^multipart\/form-data; boundary=/u)
        const form = await formOf(request)
        expect(Object.keys(form)).toEqual(['file', 'is_private'])
        expect(form['is_private']).toBe('1')
        const file = form['file'] as File
        expect(file.name).toBe('invoice.pdf')
        expect(await file.text()).toBe('%PDF')
    })

    it('keeps the bytes as they are', async () => {
        const bytes = new Uint8Array([0, 255, 37, 80, 68, 70])
        const form = await formOf(await uploaded(new Blob([bytes]), { fileName: 'raw.bin' }))
        expect(new Uint8Array(await (form['file'] as File).arrayBuffer())).toEqual(bytes)
    })

    it.each([
        ['a Blob', new Blob(['x']), undefined, 'file'],
        ['a File without a name', new File(['x'], ''), undefined, 'file'],
        ['a Blob with fileName', new Blob(['x']), 'notes.txt', 'notes.txt'],
        ['a File with fileName', new File(['x'], 'a.txt'), 'b.txt', 'b.txt'],
    ])('names %s %j', async (_title, file, fileName, expected) => {
        const form = await formOf(await uploaded(file, fileName === undefined ? {} : { fileName }))
        expect((form['file'] as File).name).toBe(expected)
    })

    it('sends every option it was given', async () => {
        const form = await formOf(
            await uploaded(new Blob(['x']), {
                fileName: 'photo.png',
                isPrivate: false,
                folder: 'Home/Attachments',
                attachTo: { doctype: 'Sales Invoice', name: 'SINV-0001', field: 'scan' },
                optimize: true,
            }),
        )
        expect(Object.fromEntries(Object.entries(form).filter(([key]) => key !== 'file'))).toEqual({
            is_private: '0',
            folder: 'Home/Attachments',
            doctype: 'Sales Invoice',
            docname: 'SINV-0001',
            fieldname: 'scan',
            optimize: '1',
        })
    })

    it('attaches to a document with a numeric name, without a field', async () => {
        const form = await formOf(await uploaded(new Blob(['x']), { attachTo: { doctype: 'FF Counter', name: 7 } }))
        expect(form).toMatchObject({ doctype: 'FF Counter', docname: '7' })
        expect(form).not.toHaveProperty('fieldname')
    })

    it('leaves `optimize` out when it is false, since Frappe reads "0" as true', async () => {
        const form = await formOf(await uploaded(new Blob(['x']), { optimize: false }))
        expect(form).not.toHaveProperty('optimize')
    })

    it('passes the request options on', async () => {
        const request = await uploaded(new Blob(['x']), { headers: { 'X-Trace': '1' } })
        expect(request.headers.get('x-trace')).toBe('1')
    })

    it('passes a refused upload through as a PermissionError', async () => {
        const { frappe } = client([json(403, { exc_type: 'PermissionError' })])
        await expect(frappe.file.upload(new Blob(['x']))).rejects.toThrow(PermissionError)
    })

    it('rejects an answer without a File document', async () => {
        const { frappe } = client([json(200, { message: { name: 'a1b2c3' } })])
        await expect(frappe.file.upload(new Blob(['x']))).rejects.toThrow(
            `Expected a File document in \`message\` from POST ${UPLOAD}.`,
        )
    })

    it.each([
        ['a string as the file', 'invoice.pdf', {}, '`file` must be a Blob or a File.'],
        ['null as the options', new Blob(['x']), null, '`options` must be an object.'],
        ['a string as the options', new Blob(['x']), 'invoice.pdf', '`options` must be an object.'],
        ['an empty fileName', new Blob(['x']), { fileName: '' }, '`fileName` must be a non-empty string.'],
        ['a non-string fileName', new Blob(['x']), { fileName: 1 }, '`fileName` must be a non-empty string.'],
        ['a non-boolean isPrivate', new Blob(['x']), { isPrivate: 'no' }, '`isPrivate` must be a boolean.'],
        ['a non-boolean optimize', new Blob(['x']), { optimize: 1 }, '`optimize` must be a boolean.'],
        ['an empty folder', new Blob(['x']), { folder: '' }, '`folder` must be a non-empty string.'],
        [
            'an attachTo that is not an object',
            new Blob(['x']),
            { attachTo: 'ToDo' },
            '`attachTo` must be an object with the `doctype` and `name` of a document.',
        ],
        [
            'an attachTo without a DocType',
            new Blob(['x']),
            { attachTo: { name: 'TODO-0001' } },
            '`doctype` must be a non-empty string.',
        ],
        [
            'an attachTo without a name',
            new Blob(['x']),
            { attachTo: { doctype: 'ToDo' } },
            '`attachTo.name` must be a non-empty string or a positive integer.',
        ],
        [
            'an attachTo with an invalid field',
            new Blob(['x']),
            { attachTo: { doctype: 'ToDo', name: 'TODO-0001', field: 'a b' } },
            '`attachTo.field` must be a field name such as "modified"; got a b.',
        ],
    ])('rejects %s, before any request', async (_title, file, options, message) => {
        const { frappe, requests } = client()
        await expect(frappe.file.upload(file as Blob, options as UploadOptions)).rejects.toThrow(
            new InvalidArgumentError(message),
        )
        expect(requests).toHaveLength(0)
    })
})

describe('file.download', () => {
    it('gets the file from its own URL, each segment encoded, and returns its bytes and type', async () => {
        const bytes = new Uint8Array([37, 80, 68, 70, 0, 255, 0xe2, 0xe3])
        const { frappe, requests } = client([new Response(bytes, { headers: { 'content-type': 'application/pdf' } })])
        const blob = await frappe.file.download('/private/files/a b#1?.pdf')
        expect(blob.type).toBe('application/pdf')
        expect(new Uint8Array(await blob.arrayBuffer())).toEqual(bytes)
        const request = only(requests)
        expect(request.method).toBe('GET')
        expect(request.url).toBe(`${url}/private/files/a%20b%231%3F.pdf`)
    })

    it('gets a public file from its URL', async () => {
        const { frappe, requests } = client([new Response('x')])
        await frappe.file.download('/files/logo.png')
        expect(only(requests).url).toBe(`${url}/files/logo.png`)
    })

    it('sends a stored URL that is already percent-encoded as it is stored', async () => {
        const { frappe, requests } = client([new Response('x')])
        await frappe.file.download('/files/a%20b.png')
        expect(only(requests).url).toBe(`${url}/files/a%2520b.png`)
    })

    it('returns a file sent without a content type', async () => {
        const { frappe } = client([new Response(new Blob(['x']))])
        const blob = await frappe.file.download('/files/notes')
        expect(await blob.text()).toBe('x')
    })

    it('rejects an HTML page that answers in place of the file', async () => {
        // What a dev server that forwards only /api to Frappe answers for every other path.
        const page = new Response('<!doctype html><title>App</title>', {
            headers: { 'content-type': 'text/html; charset=utf-8' },
        })
        const { frappe } = client([page])
        const error = await frappe.file.download('/private/files/invoice.pdf').catch((reason: unknown) => reason)
        expect(error).toBeInstanceOf(FrappeError)
        expect(error).toMatchObject({
            name: 'FrappeError',
            status: 200,
            message: `Expected the file from GET ${url}/private/files/invoice.pdf, received an HTML page. Check that /files/ and /private/files/ reach Frappe, not only /api/.`,
        })
    })

    it.each(['/files/page.html', '/private/files/Report.HTM', '/files/notes.shtml'])(
        'returns an HTML file stored on the site: %s',
        async (fileUrl) => {
            const { frappe } = client([new Response('<p>hi</p>', { headers: { 'content-type': 'text/html' } })])
            const blob = await frappe.file.download(fileUrl)
            expect(await blob.text()).toBe('<p>hi</p>')
        },
    )

    it("passes Frappe's refusal of a missing or unreadable file through as a PermissionError", async () => {
        // What Frappe answers for a private file, on Frappe 15 and 16 alike: an HTML page, not JSON.
        const forbidden = new Response(
            '<!doctype html>\n<html lang=en>\n<title>403 Forbidden</title>\n<h1>Forbidden</h1>\n<p>You don&#39;t have permission to access this file</p>\n',
            { status: 403, headers: { 'content-type': 'text/html; charset=utf-8' } },
        )
        const { frappe } = client([forbidden])
        await expect(frappe.file.download('/private/files/secret.pdf')).rejects.toThrow(
            expect.objectContaining({ name: 'PermissionError', status: 403, message: '403 Forbidden' }),
        )
    })

    it.each([
        ['an empty URL', ''],
        ['a non-string URL', 1],
        ['an external URL', 'https://example.com/files/a.pdf'],
        ['a URL outside the file folders', '/api/method/frappe.ping'],
        ['the folder itself', '/private/files/'],
        ['a URL that leaves the folder', '/files/../api/method/frappe.ping'],
    ])('rejects %s, before any request', async (_title, fileUrl) => {
        const { frappe, requests } = client()
        await expect(frappe.file.download(fileUrl as string)).rejects.toThrow(
            new InvalidArgumentError(
                '`fileUrl` must be the `file_url` of a file on the site, such as "/private/files/invoice.pdf".',
            ),
        )
        expect(requests).toHaveLength(0)
    })
})
