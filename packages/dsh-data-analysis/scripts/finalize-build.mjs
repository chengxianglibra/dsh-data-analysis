import { chmodSync } from 'node:fs'
import './build-client.mjs'

chmodSync(new URL('../lib/bin/environment.js', import.meta.url), 0o755)
