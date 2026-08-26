import type { MarivoEnvironment } from './binding.ts'
import type { SharedMarivoRuntime } from './types.ts'

/** Serialize only stable Runtime and admitted Environment identity for the operator CLI. */
export function environmentPayload(
  runtime: SharedMarivoRuntime,
  environment: MarivoEnvironment,
): Record<string, unknown> {
  return {
    status: environment.status,
    runtimeRoot: runtime.runtimeRoot,
    skillsRoot: runtime.skillsRoot,
    projectRoot: environment.binding.projectRoot,
    pythonExecutable: environment.binding.pythonExecutable,
    marivo: {
      version: environment.binding.marivoVersion,
      packagePath: environment.binding.packagePath,
    },
    fingerprint: environment.binding.fingerprint,
  }
}
