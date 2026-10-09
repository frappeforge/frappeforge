import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { onTestFinished } from 'vitest'

/** A new temporary directory holding `files` (relative path → text), removed when the test finishes. */
export async function tempDir(files: Readonly<Record<string, string>> = {}): Promise<string> {
    const dir = await mkdtemp(path.join(tmpdir(), 'frappeforge-codegen-'))
    onTestFinished(() => rm(dir, { recursive: true, force: true }))
    for (const [relativePath, text] of Object.entries(files)) {
        const file = path.join(dir, relativePath)
        await mkdir(path.dirname(file), { recursive: true })
        await writeFile(file, text)
    }
    return dir
}
