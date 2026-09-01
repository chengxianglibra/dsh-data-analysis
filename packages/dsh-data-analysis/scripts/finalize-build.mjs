import { chmodSync } from 'node:fs'
import './build-client.mjs'

chmodSync(new URL('../lib/bin/environment.js', import.meta.url), 0o755)
chmodSync(new URL('../lib/report-check/cli.js', import.meta.url), 0o755)
