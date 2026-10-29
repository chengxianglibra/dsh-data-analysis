import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const packageRoot = fileURLToPath(new URL('../../', import.meta.url))
const metadata = JSON.parse(await readFile(path.join(packageRoot, 'package.json'), 'utf8'))
const hostPackages = Object.keys(metadata.peerDependencies ?? {}).filter((name) =>
  name.startsWith('@deepseek-ai/'),
)

/**
 * Fail closed on bundled Host code, a second Host React, and unknown runtime imports.
 * @param {import('esbuild').Metafile} meta
 */
export function assertBrowserInputs(meta) {
  for (const input of Object.keys(meta.inputs)) {
    if (input === '<stdin>') continue
    const normalized = input.replaceAll('\\', '/')
    if (/(?:^|\/)node_modules\//.test(normalized)) {
      if (/(?:^|\/)node_modules\/@deepseek-ai\//.test(normalized))
        throw new Error(`host-module-in-browser:${input}`)
      if (/(?:^|\/)node_modules\/(?:react|react-dom)\//.test(normalized))
        throw new Error(`duplicate-host-react:${input}`)
      continue
    }
    const relative = path.relative(packageRoot, path.resolve(input)).replaceAll('\\', '/')
    if (
      /^(?:src\/client(?:\.tsx|\/)|src\/(?:datasource\/changes-contract|lifecycle)\.ts$|src\/presentation\/(?:contracts\/|receipt\.ts$)|src\/semantic-reference\/(?:contracts|labels)\.ts$|src\/semantic-browser\/(?:contracts|definition)\.ts$)/.test(
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
        /^react(?:-dom)?(?:\/.*)?$/.test(item.path) ||
        hostPackages.some((name) => item.path === name || item.path.startsWith(`${name}/`))
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
    // These fixed npm tarballs omit the full license. Keep the upstream texts in the build inputs.
    /** @type {Record<string, string>} */
    const omittedLicenses = {
      'format@0.2.2': 'https://sjs.mit-license.org/',
      'react-remove-scroll-bar@2.3.8':
        'https://raw.githubusercontent.com/theKashey/react-remove-scroll-bar/8ca9ba5ea52de03308fe8ced94f7b159a44d28ff/LICENSE',
      'remark-math@6.0.0':
        'https://raw.githubusercontent.com/remarkjs/remark-math/d5d0660b150810a535bbb07eac6cc96a4510aa24/license',
      'rehype-katex@7.0.1':
        'https://raw.githubusercontent.com/remarkjs/remark-math/rehype-katex%407.0.1/license',
    }
    const sourceUrl = omittedLicenses[`${metadata.name}@${metadata.version}`]
    if (!files.length && sourceUrl) {
      files.push({
        file: 'LICENSE.txt',
        sourceUrl,
        text: await readFile(
          new URL(
            `./third-party/${metadata.name}-${metadata.version}-LICENSE.txt`,
            import.meta.url,
          ),
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
