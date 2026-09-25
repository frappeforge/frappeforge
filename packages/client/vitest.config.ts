import type { ViteUserConfig } from 'vitest/config'

import { createVitestConfig } from '../../vitest.shared.ts'
import pkg from './package.json' with { type: 'json' }

const config: ViteUserConfig = createVitestConfig(pkg, {
    test: {
        typecheck: {
            // The default, `tsconfig.json`, includes only `src`, so the type tests would never be
            // compiled and every assertion would pass.
            tsconfig: 'tsconfig.test.json',
            // `tsconfig.test.json` leaves the Register augmentation out of its program, so Vitest
            // would report it as passed without checking it. `pnpm typecheck` checks it in its own
            // program (tests/register/tsconfig.json).
            exclude: ['tests/register/**'],
        },
    },
})

export default config
