import { randomUUID } from 'node:crypto'
import { link, mkdir, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { bindMarivoEnvironment, type MarivoEnvironment } from './binding.ts'
import { MarivoEnvironmentError } from './errors.ts'
import type { MarivoWorkspaceLayout, SharedMarivoRuntime } from './types.ts'

const MANIFEST = 'marivo.toml'
const MODELS = 'models'
const STATE = '.marivo'

async function assertDirectory(target: string, label: string): Promise<void> {
  try {
    if (!(await stat(target)).isDirectory()) throw new Error('not a directory')
  } catch (cause) {
    throw new MarivoEnvironmentError(
      'workspace-initialization-failed',
      `Marivo Workspace ${label} path is not a directory: ${target}`,
      { path: target, label },
      { cause },
    )
  }
}

async function ensureDirectory(target: string, label: string, created: string[]): Promise<void> {
  try {
    await mkdir(target)
    created.push(label)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
      throw new MarivoEnvironmentError(
        'workspace-initialization-failed',
        `Could not create Marivo Workspace ${label}: ${target}`,
        { path: target, label },
        { cause: error },
      )
    }
    await assertDirectory(target, label)
  }
}

function manifestText(projectRoot: string): string {
  const projectName = path.basename(projectRoot) || 'workspace'
  return `[project]\nname = ${JSON.stringify(projectName)}\n`
}

async function ensureManifest(target: string, projectRoot: string, created: string[]): Promise<void> {
  const temporary = path.join(projectRoot, `.marivo-${randomUUID()}.toml`)
  try {
    await writeFile(temporary, manifestText(projectRoot), { encoding: 'utf8', flag: 'wx', mode: 0o644 })
    await link(temporary, target)
    created.push(MANIFEST)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
      throw new MarivoEnvironmentError(
        'workspace-initialization-failed',
        `Could not create Marivo Workspace manifest: ${target}`,
        { manifestPath: target },
        { cause: error },
      )
    }
    try {
      if (!(await stat(target)).isFile()) throw new Error('not a file')
      await readFile(target, 'utf8')
    } catch (cause) {
      throw new MarivoEnvironmentError(
        'workspace-initialization-failed',
        `Marivo Workspace manifest is not a readable file: ${target}`,
        { manifestPath: target },
        { cause },
      )
    }
  } finally {
    await rm(temporary, { force: true })
  }
}

/** Create only the minimal Marivo project layout; never install Python or Workspace skills. */
export async function initializeMarivoWorkspace(projectRoot: string): Promise<MarivoWorkspaceLayout> {
  let canonicalRoot: string
  try {
    canonicalRoot = await realpath(path.resolve(projectRoot))
    await assertDirectory(canonicalRoot, 'root')
  } catch (cause) {
    if (cause instanceof MarivoEnvironmentError) throw cause
    throw new MarivoEnvironmentError(
      'project-root-invalid',
      `Marivo project root is not an existing directory: ${path.resolve(projectRoot)}`,
      { projectRoot: path.resolve(projectRoot) },
      { cause },
    )
  }
  const created: string[] = []
  const modelsPath = path.join(canonicalRoot, MODELS)
  const statePath = path.join(canonicalRoot, STATE)
  const manifestPath = path.join(canonicalRoot, MANIFEST)
  await ensureDirectory(modelsPath, MODELS, created)
  await ensureDirectory(statePath, STATE, created)
  await ensureManifest(manifestPath, canonicalRoot, created)
  return { projectRoot: canonicalRoot, manifestPath, modelsPath, statePath, created }
}

/** Cache one Workspace initialization and binding while retaining project-specific doctor state. */
export class MarivoWorkspaceEnvironmentManager {
  readonly runtime: SharedMarivoRuntime
  readonly initializeWorkspace: boolean
  #bindings = new Map<string, Promise<MarivoEnvironment>>()

  constructor(runtime: SharedMarivoRuntime, initializeWorkspace = true) {
    this.runtime = runtime
    this.initializeWorkspace = initializeWorkspace
  }

  async resolve(projectRoot: string): Promise<MarivoEnvironment> {
    const canonicalRoot = await realpath(path.resolve(projectRoot))
    let binding = this.#bindings.get(canonicalRoot)
    if (binding === undefined) {
      binding = (async () => {
        if (this.initializeWorkspace) await initializeMarivoWorkspace(canonicalRoot)
        return bindMarivoEnvironment({
          projectRoot: canonicalRoot,
          pythonExecutable: this.runtime.pythonExecutable,
        })
      })()
      this.#bindings.set(canonicalRoot, binding)
    }
    return binding
  }

  dispose(): void {
    this.#bindings.clear()
  }
}
