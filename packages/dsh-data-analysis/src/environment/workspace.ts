import { realpath, stat } from 'node:fs/promises'
import path from 'node:path'
import { finishCleanup, PendingTasks } from '../lifecycle.ts'
import { bindMarivoEnvironment, type MarivoEnvironment } from './binding.ts'
import { MarivoEnvironmentError } from './errors.ts'
import type { SharedMarivoRuntime } from './types.ts'

async function assertDirectory(target: string, label: string): Promise<void> {
  try {
    if (!(await stat(target)).isDirectory()) throw new Error('not a directory')
  } catch (cause) {
    throw new MarivoEnvironmentError(
      'project-root-invalid',
      `Marivo Workspace ${label} path is not a directory: ${target}`,
      { path: target, label },
      { cause },
    )
  }
}

async function canonicalWorkspaceRoot(projectRoot: string): Promise<string> {
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
  return canonicalRoot
}

/** Cache one zero-init Workspace binding while retaining project-specific doctor state. */
export class MarivoWorkspaceEnvironmentManager {
  readonly #tasks = new PendingTasks()
  #disposed = false
  #closing: Promise<void> | undefined
  readonly runtime: SharedMarivoRuntime
  #bindings = new Map<string, Promise<MarivoEnvironment>>()

  constructor(runtime: SharedMarivoRuntime) {
    this.runtime = runtime
  }

  resolve(projectRoot: string): Promise<MarivoEnvironment> {
    return this.#tasks.track(this.#resolve(projectRoot))
  }

  async #resolve(projectRoot: string): Promise<MarivoEnvironment> {
    if (this.#disposed) throw new Error('Marivo Workspace manager disposed')
    const canonicalRoot = await canonicalWorkspaceRoot(projectRoot)
    if (this.#disposed) throw new Error('Marivo Workspace manager disposed')
    let binding = this.#bindings.get(canonicalRoot)
    if (binding === undefined) {
      binding = bindMarivoEnvironment(
        {
          projectRoot: canonicalRoot,
          pythonExecutable: this.runtime.pythonExecutable,
        },
        {
          presentationKit: {
            version: this.runtime.presentationKitVersion,
            packagePath: this.runtime.presentationKitPackagePath,
          },
        },
      )
      this.#bindings.set(canonicalRoot, binding)
    }
    return binding
  }

  close(): Promise<void> {
    this.dispose()
    this.#closing ??= finishCleanup([() => this.#tasks.drain()])
    return this.#closing
  }

  dispose(): void {
    this.#disposed = true
    this.#bindings.clear()
  }
}
