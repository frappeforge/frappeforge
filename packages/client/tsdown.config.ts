import type { UserConfig } from 'tsdown'

import { createTsdownConfig } from '../../tsdown.shared.ts'
import pkg from './package.json' with { type: 'json' }

const config: UserConfig = createTsdownConfig(pkg)

export default config
