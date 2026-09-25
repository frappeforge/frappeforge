import type { ViteUserConfig } from 'vitest/config'

import { createVitestConfig } from '../../vitest.shared.ts'
import pkg from './package.json' with { type: 'json' }

const config: ViteUserConfig = createVitestConfig(pkg, {
    // The CLI entry is exercised end-to-end against dist/ by scripts/verify-dist.mjs.
    test: { coverage: { exclude: ['src/cli.ts'] } },
})

export default config
