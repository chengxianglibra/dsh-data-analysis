import { z } from 'zod'
import { MarivoEnvironmentError } from './environment/errors.ts'

export const pythonException = z.strictObject({
  type: z.string().min(1),
  message: z.string(),
  code: z.union([z.string(), z.number()]).optional(),
  kind: z.string().optional(),
  expected: z.string().optional(),
  received: z.string().optional(),
  location: z.union([z.string(), z.record(z.string(), z.json())]).optional(),
  repair: z.object({ action: z.string() }).catchall(z.json()).nullable(),
})
export type PythonException = z.infer<typeof pythonException>

export function redactPythonException(
  value: PythonException,
  secrets: readonly string[],
): PythonException {
  const values = secrets.filter(Boolean).sort((a, b) => b.length - a.length)
  const redact = (item: unknown): unknown => {
    if (typeof item === 'string')
      return values.reduce((text, secret) => text.split(secret).join('[REDACTED]'), item)
    if (Array.isArray(item)) return item.map(redact)
    if (item !== null && typeof item === 'object')
      return Object.fromEntries(
        Object.entries(item).map(([key, entry]) => [String(redact(key)), redact(entry)]),
      )
    return item
  }
  return pythonException.parse(redact(value))
}

/** Public exception fields only; the upstream exception owns every repair. */
export const PYTHON_EXCEPTION_PROGRAM = String.raw`
import json
import dataclasses

def python_exception(error):
    def field(name):
        try:
            return getattr(error, name, None)
        except Exception:
            return None

    try:
        message = field("message")
        if not isinstance(message, str):
            message = str(error)
    except Exception:
        message = type(error).__name__
    result = {"type": type(error).__name__, "message": message, "repair": None}
    for name in ("code", "kind", "expected", "received", "location"):
        value = field(name)
        if isinstance(value, str) or (name == "code" and type(value) is int):
            result[name] = value
        elif name == "location" and dataclasses.is_dataclass(value) and not isinstance(value, type):
            try:
                location = dataclasses.asdict(value)
                json.dumps(location, allow_nan=False)
                result[name] = location
            except Exception:
                pass
    try:
        repair = field("repair")
        if repair is not None and callable(getattr(repair, "model_dump", None)):
            repair = repair.model_dump(mode="json")
        if isinstance(repair, dict) and isinstance(repair.get("action"), str):
            json.dumps(repair, allow_nan=False)
            result["repair"] = repair
    except Exception:
        pass  # An invalid optional field must not hide the original exception.
    return result
`.trim()

/** Keep success output intact and carry ordinary exceptions across the checked process. */
export function withPythonException(program: string): string {
  return `${PYTHON_EXCEPTION_PROGRAM}\nimport sys\ntry:\n${program
    .split('\n')
    .map((line) => `    ${line}`)
    .join(
      '\n',
    )}\nexcept Exception as error:\n    print(json.dumps({"pythonError": python_exception(error)}, allow_nan=False))\n    raise SystemExit(1)`
}

export class PythonOperationError extends MarivoEnvironmentError {
  readonly diagnostic: PythonException
  constructor(diagnostic: PythonException) {
    super('subprocess-failed', JSON.stringify(diagnostic))
    this.diagnostic = diagnostic
  }
}

export function readPythonException(stdout: Buffer): PythonException | undefined {
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(stdout).trimEnd()
    const value = z
      .strictObject({ pythonError: pythonException })
      .safeParse(JSON.parse(text.slice(text.lastIndexOf('\n') + 1)))
    return value.success ? value.data.pythonError : undefined
  } catch {
    return undefined
  }
}
