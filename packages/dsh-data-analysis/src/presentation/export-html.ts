import { randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { link, lstat, mkdir, open, realpath, unlink } from 'node:fs/promises'
import path from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { Session } from '@deepseek-ai/dsh-session'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { registerMarivoTool } from '../tool-lifecycle.ts'
import { readReceiptAsset } from './asset.ts'
import { parsePresentationBuildId } from './contracts/index.ts'
import { readReportHistory } from './reports.ts'

export const MARIVO_EXPORT_HTML_TOOL_NAME = 'marivo_export_html'
export type ExportWorkspaceSource = () =>
  | { id: string; path: string }
  | Promise<{ id: string; path: string }>

export function parseHtmlOutputPath(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !value ||
    value.length > 4096 ||
    value.includes('\\') ||
    value.includes('\0') ||
    path.isAbsolute(value) ||
    !value.endsWith('.html')
  )
    throw new Error('invalid-html-output-path')
  const segments = value.split('/')
  if (
    segments.some((part) => !part || part === '.' || part === '..') ||
    segments[0]!.toLowerCase() === '.dsh-data-analysis'
  )
    throw new Error('invalid-html-output-path')
  return value
}

/** Workspace-local hard-link publication is atomic and never replaces an existing target. */
async function writeHtml(
  root: string,
  relative: string,
  bytes: Buffer,
  assertOwner: () => Promise<void>,
) {
  const parents = [root]
  const identities: Array<{ dev: number; ino: number }> = []
  const inspect = async (filename: string) => {
    const stat = await lstat(filename)
    if (!stat.isDirectory() || stat.isSymbolicLink() || (await realpath(filename)) !== filename)
      throw new Error('html-output-directory-mismatch')
    return stat
  }
  const check = async () => {
    await assertOwner()
    for (const [index, directory] of parents.entries()) {
      const stat = await inspect(directory)
      if (stat.dev !== identities[index]!.dev || stat.ino !== identities[index]!.ino)
        throw new Error('html-output-directory-changed')
    }
  }
  identities.push(await inspect(root))
  for (const part of relative.split('/').slice(0, -1)) {
    await check()
    const directory = path.join(parents.at(-1)!, part)
    try {
      await mkdir(directory, { mode: 0o700 })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    }
    identities.push(await inspect(directory))
    parents.push(directory)
  }
  await check()
  const target = path.join(root, relative)
  // Stage at the highest ancestor on the destination filesystem, outside movable
  // output subdirectories where possible, without introducing cross-device links.
  const stagingParent =
    parents[identities.findIndex((identity) => identity.dev === identities.at(-1)!.dev)]!
  const temporary = path.join(stagingParent, `.html-export-${randomUUID()}.tmp`)
  const handle = await open(
    temporary,
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
    0o600,
  )
  const owned = await handle.stat()
  let linked = false
  const removeOwned = async (filename: string) => {
    try {
      const stat = await lstat(filename)
      if (stat.dev === owned.dev && stat.ino === owned.ino) await unlink(filename)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }
  try {
    await check()
    await handle.writeFile(bytes)
    await handle.sync()
    await check()
    await link(temporary, target)
    linked = true
    await check()
    const stat = await lstat(target)
    if (stat.dev !== owned.dev || stat.ino !== owned.ino || stat.size !== bytes.length)
      throw new Error('html-output-changed')
    await removeOwned(temporary)
    await check()
    return target
  } catch (error) {
    // Paths may have moved or been replaced. The open handle still owns the exact inode,
    // including any published hard link: erase failed output without following new paths.
    const failures: unknown[] = [error]
    try {
      await handle.truncate(0)
      await handle.sync()
    } catch (cleanupError) {
      failures.push(cleanupError)
    }
    if (linked) {
      try {
        await removeOwned(target)
      } catch (cleanupError) {
        failures.push(cleanupError)
      }
    }
    if (failures.length > 1) throw new AggregateError(failures, 'html-export-cleanup-failed')
    throw error
  } finally {
    try {
      await removeOwned(temporary)
    } finally {
      await handle.close()
    }
  }
}

export function createMarivoExportHtmlTool(source: ExportWorkspaceSource, session: Session) {
  return defineTool({
    name: MARIVO_EXPORT_HTML_TOOL_NAME,
    description:
      'Export a saved complete report as self-contained offline HTML only when requested. Uses the current Session Workspace, without analysis, Python, publication, new Builds or unsaved reader state. Specify build_id for an exact version; otherwise freezes current at call start. output_path must be a new Workspace-relative .html file; existing files are never overwritten. Returns file metadata, not HTML content. After success, call native present({files:[{path: result.path, description: "Offline HTML report"}]}) to deliver the file before your final response.',
    parameters: {
      report_id: {
        type: 'string',
        required: true,
        description: 'Saved Report ID from its receipt.',
      },
      build_id: { type: 'string', description: 'Exact saved Build ID; omit to export current.' },
      output_path: {
        type: 'string',
        required: true,
        description:
          'New Workspace-relative .html path, e.g. reports/analysis.html. Parent directories may be created.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          workspace_id: { type: 'string', required: true },
          report_id: { type: 'string', required: true },
          build_id: { type: 'string', required: true },
          path: { type: 'string', required: true },
          mime_type: { type: 'string', required: true },
          bytes: { type: 'number', required: true },
          sha256: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
      presentationMeta: (_args, value) => value,
    },
    presentCall(args) {
      return {
        card: 'generic',
        kind: 'edit',
        title: 'Export report HTML',
        locations: [{ path: args.output_path }],
      }
    },
    timeoutMs: 120_000,
    async execute(args, exec) {
      const reportId = parsePresentationBuildId(args.report_id, '/report_id')
      const buildId =
        args.build_id === undefined
          ? undefined
          : parsePresentationBuildId(args.build_id, '/build_id')
      const relative = parseHtmlOutputPath(args.output_path)
      const owner = exec.agent
      if (!owner || owner.session !== session) throw new Error('presentation-session-mismatch')
      exec.signal.throwIfAborted()
      const workspace = await source()
      const root = path.resolve(workspace.path)
      const check = async () => {
        exec.signal.throwIfAborted()
        if (owner.session !== session) throw new Error('presentation-session-mismatch')
        const current = await source()
        if (current.id !== workspace.id || path.resolve(current.path) !== root)
          throw new Error('presentation-workspace-changed')
        exec.signal.throwIfAborted()
      }
      await check()
      const history = await readReportHistory(root, workspace.id, reportId, exec.signal)
      const receipt =
        buildId === undefined
          ? history.versions[0]!.receipt
          : history.versions.find((entry) => entry.receipt.buildId === buildId)?.receipt
      if (!receipt) throw new Error('presentation-build-unavailable')
      await check()
      const asset = await readReceiptAsset(root, workspace.id, receipt, 'index.html', exec.signal)
      await check()
      const filename = await writeHtml(root, relative, asset.bytes, check)
      return {
        workspace_id: workspace.id,
        report_id: reportId,
        build_id: receipt.buildId,
        path: filename,
        mime_type: 'text/html',
        bytes: asset.bytes.length,
        sha256: asset.sha256,
      }
    },
  })
}

export function registerMarivoExportHtmlTool(
  ctx: Context,
  source: ExportWorkspaceSource,
  session: Session,
) {
  return registerMarivoTool(ctx, createMarivoExportHtmlTool(source, session))
}
