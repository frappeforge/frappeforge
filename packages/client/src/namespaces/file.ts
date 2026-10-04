// `frappe.file`: upload and download files.

import { FrappeError, InvalidArgumentError } from '../errors.js'
import { isRecord, readMember } from '../http/decode.js'
import { assertFieldName } from '../http/list-query.js'
import { assertDocName, assertDoctype } from '../http/names.js'
import type { ReadResponse, Send } from '../http/send.js'
import type { FrappeDoc, RequestOptions } from '../types.js'

/** Options for {@link FileNamespace.upload}, with a signal, and a timeout or headers for this request only. */
export interface UploadOptions extends RequestOptions {
    /**
     * The stored file name. Default: the `File`'s own name, else `file`. Give a `Blob` a name with
     * an extension: Frappe guesses the file type from it, and users without Desk access may upload
     * only images, PDF, text, CSV and Office documents.
     */
    fileName?: string
    /**
     * Whether only users who may read the file can download it. Default `true`: unlike Frappe's own
     * default, a file is public only when you say so.
     */
    isPrivate?: boolean
    /** The folder to store it in, such as `Home/Attachments`. Frappe's default: `Home`. */
    folder?: string
    /**
     * The document to attach it to, and optionally the Attach field it is for. Frappe records the
     * field on the `File` (`attached_to_field`) but does not set it on the document: to fill it,
     * follow with `frappe.doc.setValue(doctype, name, { [field]: file.file_url })`, as Desk does.
     */
    attachTo?: { doctype: string; name: string | number; field?: string }
    /** Asks Frappe to shrink an image; other files are stored as they are. */
    optimize?: boolean
}

/** A stored file: what {@link FileNamespace.upload} resolves with. Empty fields are absent. */
export interface FileDoc extends FrappeDoc {
    /** Always `File`. */
    doctype: 'File'
    /** A generated hash. */
    name: string
    /** The stored file name. */
    file_name: string
    /** Where the file is served: `/private/files/…` for a private file, else `/files/…`. */
    file_url: string
    /** `1` for a private file. */
    is_private: 0 | 1
    /** Size in bytes. */
    file_size?: number
    /** The extension, upper-cased, such as `PDF`. */
    file_type?: string
    /** The folder it is stored in, such as `Home/Attachments`. */
    folder?: string
    /** The DocType of the document it is attached to. */
    attached_to_doctype?: string
    /** The name of the document it is attached to. */
    attached_to_name?: string | number
    /** The Attach field of that document that holds it. */
    attached_to_field?: string
    /** A hash of the content, which Frappe uses to store identical files once. */
    content_hash?: string
}

/**
 * `frappe.file`: upload and download files. Function properties, so they can be destructured.
 *
 * Every method rejects with a `FrappeError` subclass: the status errors with the server's
 * messages, `TimeoutError`, `AbortError`, `NetworkError`, or `InvalidArgumentError` — before any
 * request — for an invalid argument.
 */
export interface FileNamespace {
    /**
     * Uploads a file and returns its `File` document. The file is **private** unless you pass
     * `isPrivate: false`: only users who may read it can download it.
     *
     * In Node, `openAsBlob` from `node:fs` streams a file from disk without reading it into memory.
     * Sending the file counts against the timeout: pass a longer `timeout` for a large file. A file
     * larger than the site's maximum file size is a `ValidationError`.
     *
     * @param file - A `Blob` or a `File`.
     * @param options - Where to store it, what to attach it to, and a signal, a timeout or headers
     * for this request only.
     *
     * @example
     * ```ts
     * import { openAsBlob } from 'node:fs'
     *
     * const file = await frappe.file.upload(await openAsBlob('./invoice.pdf'), {
     *     fileName: 'invoice.pdf',
     *     attachTo: { doctype: 'Sales Invoice', name: 'SINV-0001' },
     * })
     * ```
     */
    readonly upload: (file: Blob, options?: UploadOptions) => Promise<FileDoc>
    /**
     * Downloads a file the current user can read, public or private, as a `Blob`, from the file's
     * own URL, exactly as it is stored. A private file that does not exist, or that the user cannot
     * read, is a `PermissionError`: Frappe does not tell the two apart. Guest can read only public
     * files.
     *
     * The whole file is held in memory, and reading it counts against the timeout: pass a longer
     * `timeout` for a large file.
     *
     * @param fileUrl - The file's `file_url` as Frappe returns it, such as
     * `/private/files/invoice.pdf`. Only files stored on the site (`/files/…`, `/private/files/…`).
     * @param options - A signal, and a timeout or headers for this request only.
     *
     * @example
     * ```ts
     * const blob = await frappe.file.download('/private/files/invoice.pdf')
     * ```
     */
    readonly download: (fileUrl: string, options?: RequestOptions) => Promise<Blob>
}

/**
 * The bytes of a download, with the content type Frappe sent. An HTML page for a file that is not
 * HTML is what a dev server or proxy that forwards only `/api` answers: a `FrappeError` that says so.
 */
const readDownload: ReadResponse<Blob> = async (response, context) => {
    if (/^text\/html\b/iu.test(response.headers.get('content-type') ?? '') && !/\.s?html?$/iu.test(context.url)) {
        throw new FrappeError(
            `Expected the file from ${context.method} ${context.url}, received an HTML page. Check that /files/ and /private/files/ reach Frappe, not only /api/.`,
            { status: response.status, request: context },
        )
    }
    return response.blob()
}

const readFileDoc = readMember('message', isFileDoc, 'a File document')

/** Creates `frappe.file` over the client's pipeline. */
export function createFileNamespace(send: Send): FileNamespace {
    return Object.freeze({
        upload: async (file: unknown, uploadOptions: unknown = {}): Promise<FileDoc> => {
            if (!(file instanceof Blob)) throw new InvalidArgumentError('`file` must be a Blob or a File.')
            if (!isRecord(uploadOptions)) throw new InvalidArgumentError('`options` must be an object.')
            const {
                fileName,
                isPrivate = true,
                folder,
                attachTo,
                optimize = false,
                ...options
            } = uploadOptions as UploadOptions
            const name = fileName ?? (file instanceof File && file.name !== '' ? file.name : 'file')
            assertNonEmpty(name, '`fileName`')
            assertBoolean(isPrivate, '`isPrivate`')
            assertBoolean(optimize, '`optimize`')
            const form = new FormData()
            // Frappe stores the file under the name of this part, not a separate field.
            form.append('file', file, name)
            form.append('is_private', isPrivate ? '1' : '0')
            if (folder !== undefined) form.append('folder', assertNonEmpty(folder, '`folder`'))
            if (attachTo !== undefined) appendAttachment(form, attachTo)
            // Frappe tests the field's truth, and the string `'0'` is true: `false` sends nothing.
            if (optimize) form.append('optimize', '1')
            return send(
                { method: 'POST', path: '/api/method/frappe.handler.upload_file', body: form },
                options,
                readFileDoc,
            )
        },
        // The file's own URL, not `frappe.handler.download_file`: Frappe 16 reads a file through a
        // text decoding first, which changes the bytes of many binary files.
        download: async (fileUrl: unknown, options: RequestOptions = {}): Promise<Blob> =>
            send({ path: fileUrlPath(fileUrl) }, options, readDownload),
    } satisfies FileNamespace)
}

/** `attachTo` as Frappe's `doctype`, `docname` and `fieldname` fields. */
function appendAttachment(form: FormData, attachTo: unknown): void {
    if (!isRecord(attachTo)) {
        throw new InvalidArgumentError('`attachTo` must be an object with the `doctype` and `name` of a document.')
    }
    const { doctype, name, field } = attachTo
    form.append('doctype', assertDoctype(doctype))
    form.append('docname', assertDocName(name, '`attachTo.name`'))
    if (field !== undefined) {
        assertFieldName(field, '`attachTo.field`')
        form.append('fieldname', field)
    }
}

function isFileDoc(value: unknown): value is FileDoc {
    return isRecord(value) && typeof value['file_url'] === 'string'
}

/**
 * The path of a file stored on the site: `/files/…` or `/private/files/…`, each segment encoded.
 * Frappe decodes the path and looks the file up by its stored `file_url`, so the URL is sent as it is
 * stored, `%` included.
 */
function fileUrlPath(fileUrl: unknown): string {
    const segments = typeof fileUrl === 'string' ? fileUrl.split('/') : []
    if (
        typeof fileUrl !== 'string' ||
        !/^\/(?:private\/)?files\/./u.test(fileUrl) ||
        segments.some((segment) => segment === '.' || segment === '..')
    ) {
        throw new InvalidArgumentError(
            '`fileUrl` must be the `file_url` of a file on the site, such as "/private/files/invoice.pdf".',
        )
    }
    return segments.map((segment) => encodeURIComponent(segment)).join('/')
}

function assertNonEmpty(value: unknown, label: string): string {
    if (typeof value === 'string' && value !== '') return value
    throw new InvalidArgumentError(`${label} must be a non-empty string.`)
}

function assertBoolean(value: unknown, label: string): void {
    if (typeof value !== 'boolean') throw new InvalidArgumentError(`${label} must be a boolean.`)
}
