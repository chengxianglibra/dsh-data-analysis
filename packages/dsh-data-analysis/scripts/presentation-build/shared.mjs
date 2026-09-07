import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const packageRoot = fileURLToPath(new URL('../../', import.meta.url))
const metadata = JSON.parse(await readFile(path.join(packageRoot, 'package.json'), 'utf8'))
const hostPackages = Object.keys(metadata.peerDependencies ?? {}).filter((name) =>
  name.startsWith('@deepseek-ai/'),
)
const victoryLicenseSource =
  'https://raw.githubusercontent.com/FormidableLabs/victory/v37.3.6/LICENSE.txt'

/**
 * Fail closed on bundled Host code, a second Host React, and unknown runtime imports.
 * @param {import('esbuild').Metafile} meta
 * @param {{ portable: boolean }} options
 */
export function assertBrowserInputs(meta, { portable }) {
  for (const input of Object.keys(meta.inputs)) {
    if (input === '<stdin>') continue
    const normalized = input.replaceAll('\\', '/')
    if (/(?:^|\/)node_modules\//.test(normalized)) {
      if (/(?:^|\/)node_modules\/@deepseek-ai\//.test(normalized))
        throw new Error(`host-module-in-browser:${input}`)
      if (!portable && /(?:^|\/)node_modules\/(?:react|react-dom)\//.test(normalized))
        throw new Error(`duplicate-host-react:${input}`)
      continue
    }
    const relative = path.relative(packageRoot, path.resolve(input)).replaceAll('\\', '/')
    if (
      /^(?:src\/client(?:\.tsx|\/)|src\/presentation\/(?:contracts\/|receipt\.ts$)|src\/semantic-reference\/contracts\.ts$|src\/semantic-browser\/(?:contracts|definition)\.ts$)/.test(
        relative,
      )
    )
      continue
    throw new Error(`host-module-in-browser:${input}`)
  }
  for (const output of Object.values(meta.outputs)) {
    for (const item of output.imports) {
      if (!item.external) continue
      if (
        !portable &&
        (/^react(?:-dom)?(?:\/.*)?$/.test(item.path) ||
          hostPackages.some((name) => item.path === name || item.path.startsWith(`${name}/`)))
      )
        continue
      throw new Error(`unexpected-browser-external:${item.path}`)
    }
  }
}

/**
 * Collect complete licenses and notices for the packages actually included by esbuild.
 * @param {import('esbuild').Metafile} meta
 */
export async function thirdPartyNotices(meta) {
  const packageRoots = new Set()
  for (const input of Object.keys(meta.inputs)) {
    const absolute = path.resolve(input)
    const marker = `${path.sep}node_modules${path.sep}`
    const index = absolute.lastIndexOf(marker)
    if (index < 0) continue
    const prefix = absolute.slice(0, index + marker.length)
    const parts = absolute.slice(index + marker.length).split(path.sep)
    packageRoots.add(prefix + parts.slice(0, parts[0]?.startsWith('@') ? 2 : 1).join(path.sep))
  }
  const notices = []
  const seen = new Set()
  for (const root of [...packageRoots].sort()) {
    const metadata = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'))
    /** @type {{ file: string, text: string, sourceUrl?: string }[]} */
    const files = []
    const entries = await readdir(root, { withFileTypes: true })
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.isFile() && /^(?:licen[cs]e|copying|notice)(?:[._-].*)?$/i.test(entry.name)) {
        files.push({ file: entry.name, text: await readFile(path.join(root, entry.name), 'utf8') })
      }
    }
    // The published 37.3.6 package omits its root license. S0 verified this upstream tag.
    if (!files.length && metadata.name === 'victory-vendor' && metadata.version === '37.3.6') {
      files.push({
        file: 'LICENSE.txt',
        sourceUrl: victoryLicenseSource,
        text: await readFile(
          new URL('./third-party/victory-vendor-37.3.6-LICENSE.txt', import.meta.url),
          'utf8',
        ),
      })
    }
    if (!files.length)
      throw new Error(`missing-bundled-license:${metadata.name}@${metadata.version}`)
    const notice = {
      package: metadata.name,
      version: metadata.version,
      license: metadata.license,
      files,
    }
    const identity = JSON.stringify(notice)
    if (!seen.has(identity)) notices.push(notice)
    seen.add(identity)
  }
  return notices
}

/** @param {Awaited<ReturnType<typeof thirdPartyNotices>>} notices */
export function noticeComment(notices) {
  return `/*! Third-party notices\n${JSON.stringify(notices, null, 2).replaceAll('*/', '*\\/')}\n*/\n`
}
