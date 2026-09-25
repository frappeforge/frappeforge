import type { ViteUserConfig } from 'vitest/config'

import { createVitestConfig } from '../../vitest.shared.ts'
import pkg from './package.json' with { type: 'json' }

const config: ViteUserConfig = createVitestConfig(pkg)

export default config
