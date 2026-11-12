import { realpathSync } from 'node:fs'
import path from 'node:path'
import type { ImportIdentity } from './types.ts'

/** Resolve directory aliases without following a venv's Python link into its base installation. */
export function canonicalPythonExecutable(executable: string): string {
  const absolute = path.resolve(executable)
  return path.join(realpathSync(path.dirname(absolute)), path.basename(absolute))
}

export function canonicalImportIdentity(identity: ImportIdentity): ImportIdentity {
  return {
    pythonExecutable: canonicalPythonExecutable(identity.pythonExecutable),
    marivoVersion: identity.marivoVersion,
    packagePath: realpathSync(identity.packagePath),
  }
}

/** The Python equivalent of canonicalImportIdentity, shared by every execution boundary. */
export const PYTHON_IMPORT_IDENTITY = String.raw`
import os.path as _dsh_identity_path

def _dsh_python_executable(executable):
    absolute = _dsh_identity_path.abspath(executable)
    return _dsh_identity_path.join(
        _dsh_identity_path.realpath(_dsh_identity_path.dirname(absolute)),
        _dsh_identity_path.basename(absolute),
    )

def _dsh_import_identity(executable, version, package_path):
    return {
        "python_executable": _dsh_python_executable(executable),
        "marivo_version": version,
        "package_path": _dsh_identity_path.realpath(package_path),
    }
`.trim()
