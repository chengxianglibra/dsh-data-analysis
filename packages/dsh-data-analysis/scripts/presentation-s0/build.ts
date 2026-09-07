import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { build, type Metafile } from 'esbuild'
import {
  formatCell,
  parsePresentationDocument,
  parsePresentationReceipt,
} from '../../src/presentation/contracts/index.ts'
import type { PresentationDocument, TypedDataset } from '../../src/presentation/contracts/types.ts'
import { presentationAssetPath, sha256 } from './files.ts'
import { S0_STYLES } from './styles.ts'

const packageRoot = fileURLToPath(new URL('../../', import.meta.url))
const seamRoot = fileURLToPath(new URL('./', import.meta.url))
const hostExternals = ['react', 'react/*', 'react-dom', 'react-dom/*']
const victoryLicenseSource =
  'https://raw.githubusercontent.com/FormidableLabs/victory/v37.3.6/LICENSE.txt'
const escapeHtml = (value: string) =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')

/** Retain package notices for actual bundle inputs, in addition to esbuild legal comments. */
async function thirdPartyNotices(meta: Metafile) {
  const packageRoots = new Set<string>()
  for (const input of Object.keys(meta.inputs)) {
    const absolute = path.resolve(input)
    const marker = `${path.sep}node_modules${path.sep}`
    const index = absolute.lastIndexOf(marker)
    if (index < 0) continue
    const prefix = absolute.slice(0, index + marker.length)
    const parts = absolute.slice(index + marker.length).split(path.sep)
    packageRoots.add(prefix + parts.slice(0, parts[0]!.startsWith('@') ? 2 : 1).join(path.sep))
  }
  const notices = []
  const seen = new Set<string>()
  for (const root of [...packageRoots].sort()) {
    const metadata = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'))
    const files: { file: string; text: string; sourceUrl?: string }[] = []
    for (const entry of (await readdir(root, { withFileTypes: true })).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      if (entry.isFile() && /^(?:licen[cs]e|copying|notice)(?:[._-].*)?$/i.test(entry.name)) {
        files.push({ file: entry.name, text: await readFile(path.join(root, entry.name), 'utf8') })
      }
    }
    // This exact npm package omits its root license; retain the verified upstream tag text.
    // Its bundled d3 dependencies supply their own complete ISC licenses above.
    if (!files.length && metadata.name === 'victory-vendor' && metadata.version === '37.3.6') {
      files.push({
        file: 'LICENSE.txt',
        sourceUrl: victoryLicenseSource,
        text: await readFile(
          path.join(seamRoot, 'third-party/victory-vendor-37.3.6-LICENSE.txt'),
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

const safeJson = (value: unknown) =>
  JSON.stringify(value)
    .replaceAll('<', '\\u003c')
    .replaceAll('\u2028', '\\u2028')
    .replaceAll('\u2029', '\\u2029')

/** S0 uses a narrow input allowlist; the production build rule changes in S3. */
export function assertBrowserInputs(meta: Metafile, portable: boolean) {
  for (const input of Object.keys(meta.inputs)) {
    const normalized = input.replaceAll('\\', '/')
    if (normalized === '<stdin>') continue
    if (normalized.includes('/node_modules/') || normalized.startsWith('node_modules/')) {
      if (/(?:^|\/)node_modules\/@deepseek-ai\//.test(normalized))
        throw new Error(`host-module-in-browser:${input}`)
      if (!portable && /(?:^|\/)node_modules\/(?:react|react-dom)\//.test(normalized))
        throw new Error(`duplicate-host-react:${input}`)
      continue
    }
    const absolute = path.resolve(input)
    if (absolute.startsWith(path.join(packageRoot, 'src/presentation/contracts/'))) continue
    if (
      ['reader.tsx', 'portable-entry.tsx', 'host-entry.tsx', 'styles.ts'].some(
        (name) => absolute === path.join(seamRoot, name),
      )
    )
      continue
    throw new Error(`host-module-in-browser:${input}`)
  }
  for (const output of Object.values(meta.outputs)) {
    for (const item of output.imports) {
      if (!item.external) continue
      if (!portable && /^react(?:-dom)?(?:\/.*)?$/.test(item.path)) continue
      throw new Error(`unexpected-browser-external:${item.path}`)
    }
  }
}

function fallbackTable(data: TypedDataset, selected?: string[]) {
  const columns = (selected ?? data.columns.map((column) => column.id)).map((id) =>
    data.columns.findIndex((column) => column.id === id),
  )
  const headers = columns
    .map((index) => {
      const column = data.columns[index]!
      return `<th>${escapeHtml(column.label)}${column.unit ? ` (${escapeHtml(column.unit)})` : ''}</th>`
    })
    .join('')
  const rows = data.rows
    .map(
      (row) =>
        `<tr>${columns.map((index) => `<td>${escapeHtml(formatCell(row[index]!, data.columns[index]!))}</td>`).join('')}</tr>`,
    )
    .join('')
  return `<table><thead><tr>${headers}</tr></thead><tbody>${rows}</tbody></table><p>显示 ${data.rows.length} / ${data.rowCount} 行${data.truncated ? '（已截断；不能代表全量汇总）' : ''}</p>`
}

/** Minimal static content for S0 offline/print checks; accepts the same validated document. */
export function renderS0Fallback(document: PresentationDocument) {
  const blocks = document.blocks
    .map((block) => {
      if (block.kind === 'markdown') return `<p>${escapeHtml(block.text)}</p>`
      if (block.kind === 'source') {
        const sources = document.sources
          .filter((source) => block.sourceIds.includes(source.id))
          .map((source) => {
            const identity = [source.ref.sessionId, source.ref.artifactRef, source.ref.findingId]
              .filter((value) => value !== undefined)
              .map(escapeHtml)
              .join(' / ')
            const facts =
              source.status === 'unavailable'
                ? `<p>${escapeHtml(source.reason)}</p>`
                : source.facts
                    .map((fact) => `<p>${escapeHtml(fact.label)}：${escapeHtml(fact.value)}</p>`)
                    .join('')
            return `<section><h3>${escapeHtml(source.status === 'available' ? source.label : '来源不可用')}</h3><code>${identity}</code>${facts}</section>`
          })
          .join('')
        return `<section aria-label="来源"><h2>声明来源</h2>${sources}</section>`
      }
      const { data } = document.datasets.find((dataset) => dataset.id === block.datasetId)!
      if (block.kind === 'metric') {
        const index = data.columns.findIndex((column) => column.id === block.columnId)
        const column = data.columns[index]!
        const value = escapeHtml(formatCell(data.rows[block.rowIndex]![index]!, column))
        return `<section><h2>${escapeHtml(block.label)}</h2><strong>${value}${column.unit ? ` ${escapeHtml(column.unit)}` : ''}</strong></section>`
      }
      if (block.kind === 'table')
        return `<section aria-label="数据表">${fallbackTable(data, block.columns)}</section>`
      const selected = [...new Set([block.x, ...block.y])]
      const notice =
        block.numericMode === 'approximate'
          ? '图形使用近似值；下表保留精确值。'
          : '无脚本视图以已有数据表呈现图形。'
      return `<section aria-label="${block.chart} 图形"><h2>${block.chart === 'line' ? '趋势' : '对比'}</h2><p>${notice}</p>${fallbackTable(data, selected)}</section>`
    })
    .join('')
  const diagnostics = document.diagnostics
    .map((diagnostic) => `<p>${escapeHtml(diagnostic.message)}</p>`)
    .join('')
  return `<article class="presentation-s0" data-build-id="${escapeHtml(document.buildId)}"><header><small>S0 · 展示接缝验证样例</small><h1>${escapeHtml(document.title)}</h1></header>${blocks}${diagnostics}</article>`
}

export async function buildS0Artifacts(root: string, documents: PresentationDocument[]) {
  const portable = await build({
    entryPoints: [path.join(seamRoot, 'portable-entry.tsx')],
    bundle: true,
    write: false,
    platform: 'browser',
    format: 'iife',
    jsx: 'automatic',
    target: 'es2022',
    minify: true,
    legalComments: 'eof',
    define: { 'process.env.NODE_ENV': '"production"' },
    metafile: true,
  })
  assertBrowserInputs(portable.metafile, true)
  const portableNotices = await thirdPartyNotices(portable.metafile)
  const receipts = []
  for (const value of documents) {
    const document = parsePresentationDocument(value)
    const json = JSON.stringify(document)
    const html = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(document.title)}</title><style>${S0_STYLES}</style><div id="fallback">${renderS0Fallback(document)}</div><div id="reader"></div><script id="presentation-data" type="application/json">${safeJson(document)}</script><script id="third-party-notices" type="application/json">${safeJson(portableNotices)}</script><script>${portable.outputFiles[0]!.text.replaceAll('</script', '<\\/script')}</script></html>`
    const documentPath = presentationAssetPath(root, document.buildId, 'presentation.json')
    const htmlPath = presentationAssetPath(root, document.buildId, 'index.html')
    await mkdir(path.dirname(documentPath), { recursive: true })
    await writeFile(documentPath, json, { flag: 'wx' })
    await writeFile(htmlPath, html, { flag: 'wx' })
    const file = (asset: 'presentation.json' | 'index.html', filePath: string, bytes: string) => ({
      asset,
      path: filePath,
      sha256: sha256(Buffer.from(bytes)),
      bytes: Buffer.byteLength(bytes),
    })
    receipts.push(
      parsePresentationReceipt({
        schemaVersion: 2,
        kind: 'marivo.presentation',
        workspaceId: document.workspaceId,
        reportId: 'report',
        buildId: document.buildId,
        title: document.title,
        summary: 'S0 接缝验证产物；完整 present 在 S4 接入。',
        files: {
          document: file('presentation.json', documentPath, json),
          html: file('index.html', htmlPath, html),
        },
      }),
    )
  }
  const host = await build({
    stdin: {
      resolveDir: seamRoot,
      loader: 'ts',
      contents: `import {installS0} from './host-entry.tsx'; export const inject=['connection','slots']; export function apply(ctx){installS0(ctx,${JSON.stringify(receipts)})}`,
    },
    bundle: true,
    write: false,
    platform: 'browser',
    format: 'cjs',
    jsx: 'automatic',
    target: 'es2022',
    external: hostExternals,
    define: { 'process.env.NODE_ENV': '"production"' },
    minify: true,
    legalComments: 'eof',
    metafile: true,
  })
  assertBrowserInputs(host.metafile, false)
  const hostNotices = await thirdPartyNotices(host.metafile)
  const id = 'dsh-presentation-s0'
  const noticeComment = `/*! Third-party notices\n${JSON.stringify(hostNotices, null, 2).replaceAll('*/', '*\\/')}\n*/\n`
  const client = `${noticeComment}window.__ModuleLoader__.load({id:${JSON.stringify(id)},factory:(require)=>{var module={exports:{}};var exports=module.exports;${host.outputFiles[0]!.text};return module.exports;}});`
  return {
    receipts,
    client,
    portableMetafile: portable.metafile,
    hostMetafile: host.metafile,
    hostBytes: Buffer.byteLength(client),
    portableBytes: portable.outputFiles[0]!.contents.length,
  }
}
