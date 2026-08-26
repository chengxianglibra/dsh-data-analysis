import { rmSync } from 'node:fs'

const libDirectory = new URL('../lib/', import.meta.url)
rmSync(libDirectory, { force: true, recursive: true })
