import { chmodSync } from 'node:fs'

chmodSync(new URL('../lib/bin/environment.js', import.meta.url), 0o755)
