import type { UserConfig } from 'tsdown'

import { createTsdownConfig } from '../../tsdown.shared.ts'
import pkg from './package.json' with { type: 'json' }

const config: UserConfig[] = [
    createTsdownConfig(pkg, { platform: 'node', target: 'node22' }),
    // The CLI is executed, never imported: no declarations.
    createTsdownConfig(pkg, {
        entry: { cli: 'src/cli.ts' },
        platform: 'node',
        target: 'node22',
        dts: false,
        clean: false,
    }),
]

export default config
