#!/usr/bin/env node

import { constants, copyFile, lstat, mkdir, realpath } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const skillRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const starterRoot = path.join(skillRoot, 'starter')

const components = new Map([
  ['report-data', 'report-data.js'],
  ['report-charts', 'report-charts.js'],
  ['report-trace', 'report-trace.js'],
])
const snippets = new Map([
  ['dataset-scripts', 'dataset-scripts.html'],
  ['chart-with-table', 'chart-with-table.html'],
  ['kpi-grid', 'kpi-grid.html'],
  ['marivo-session-trace', 'marivo-session-trace.html'],
  ['mount-error', 'mount-error.js'],
])

class CopyStarterError extends Error {
  constructor(code, message) {
    super(message)
    this.code = code
  }
}

function parseArguments(arguments_) {
  const parsed = { basic: false, components: [], snippets: [], target: null }
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index]
    if (argument === '--basic') {
      parsed.basic = true
      continue
    }
    if (argument === '--target' || argument === '--component' || argument === '--snippet') {
      const value = arguments_[index + 1]
      if (!value || value.startsWith('--')) {
        throw new CopyStarterError('argument-invalid', `${argument} requires a value`)
      }
      index += 1
      if (argument === '--target') {
        if (parsed.target !== null) {
          throw new CopyStarterError('argument-invalid', '--target may be provided only once')
        }
        parsed.target = value
      } else if (argument === '--component') parsed.components.push(value)
      else parsed.snippets.push(value)
      continue
    }
    throw new CopyStarterError('argument-invalid', `unknown argument: ${argument}`)
  }
  if (parsed.target === null) {
    throw new CopyStarterError('target-required', '--target is required')
  }
  if (!parsed.basic && parsed.components.length === 0 && parsed.snippets.length === 0) {
    throw new CopyStarterError('selection-required', 'select --basic, --component, or --snippet')
  }
  return parsed
}

async function assertPathHasNoSymlink(root, target) {
  const relative = path.relative(root, target)
  let current = root
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment)
    const status = await lstat(current).catch((error) => {
      if (error.code === 'ENOENT') return null
      throw error
    })
    if (status === null) return
    if (status.isSymbolicLink()) {
      throw new CopyStarterError('target-symlink', 'target path contains a symbolic link')
    }
  }
}

function resolveSelection(parsed, targetRoot) {
  const copies = []
  if (parsed.basic) {
    copies.push(
      [path.join(starterRoot, 'basic', 'index.html'), path.join(targetRoot, 'index.html')],
      [
        path.join(starterRoot, 'basic', 'assets', 'report-base.css'),
        path.join(targetRoot, 'assets', 'report-base.css'),
      ],
    )
  }
  for (const name of parsed.components) {
    const filename = components.get(name)
    if (!filename) {
      throw new CopyStarterError('component-unknown', `unknown component: ${name}`)
    }
    copies.push([
      path.join(starterRoot, 'components', filename),
      path.join(targetRoot, 'assets', filename),
    ])
  }
  for (const name of parsed.snippets) {
    const filename = snippets.get(name)
    if (!filename) throw new CopyStarterError('snippet-unknown', `unknown snippet: ${name}`)
    copies.push([
      path.join(starterRoot, 'snippets', filename),
      path.join(targetRoot, 'snippets', filename),
    ])
  }
  const destinations = copies.map(([, destination]) => destination)
  if (new Set(destinations).size !== destinations.length) {
    throw new CopyStarterError(
      'selection-duplicate',
      'the same resource was selected more than once',
    )
  }
  return copies
}

async function main() {
  const parsed = parseArguments(process.argv.slice(2))
  if (path.isAbsolute(parsed.target)) {
    throw new CopyStarterError('target-invalid', '--target must be Workspace-relative')
  }
  const normalized = path.normalize(parsed.target)
  if (normalized === '.' || normalized === '..' || normalized.startsWith(`..${path.sep}`)) {
    throw new CopyStarterError(
      'target-invalid',
      '--target must name a directory inside the Workspace',
    )
  }

  const workspaceRoot = await realpath(process.cwd())
  const targetRoot = path.resolve(workspaceRoot, normalized)
  const relativeTarget = path.relative(workspaceRoot, targetRoot)
  if (
    !relativeTarget ||
    relativeTarget.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativeTarget)
  ) {
    throw new CopyStarterError('target-invalid', '--target escapes the Workspace')
  }
  await assertPathHasNoSymlink(workspaceRoot, targetRoot)

  const copies = resolveSelection(parsed, targetRoot)
  for (const [source, destination] of copies) {
    const sourceStatus = await lstat(source)
    if (!sourceStatus.isFile() || sourceStatus.isSymbolicLink()) {
      throw new CopyStarterError('source-invalid', 'selected resource is not a regular source file')
    }
    const destinationStatus = await lstat(destination).catch((error) => {
      if (error.code === 'ENOENT') return null
      throw error
    })
    if (destinationStatus !== null) {
      throw new CopyStarterError(
        'target-exists',
        `refusing to overwrite ${path.relative(workspaceRoot, destination)}`,
      )
    }
  }

  for (const [, destination] of copies) await mkdir(path.dirname(destination), { recursive: true })
  await assertPathHasNoSymlink(workspaceRoot, targetRoot)
  for (const [source, destination] of copies) {
    await copyFile(source, destination, constants.COPYFILE_EXCL)
    process.stdout.write(`${path.relative(workspaceRoot, destination)}\n`)
  }
}

main().catch((error) => {
  const code = typeof error?.code === 'string' ? error.code : 'copy-failed'
  const message = error instanceof Error ? error.message : 'copy failed'
  process.stderr.write(`${code}: ${message}\n`)
  process.exitCode = 1
})
