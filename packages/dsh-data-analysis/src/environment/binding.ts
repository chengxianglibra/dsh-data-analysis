import { access, constants, realpath, stat } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import path from 'node:path'
import process from 'node:process'
import { admitDoctorReport, parseDoctorReport } from './doctor.ts'
import { MarivoEnvironmentError } from './errors.ts'
import { FixedSubprocessPolicy } from './subprocess.ts'
import type {
  ImportIdentity,
  MarivoEnvironmentBinding,
  MarivoEnvironmentConfig,
  SubprocessLimits,
} from './types.ts'

const DOCTOR_LIMITS: Readonly<Partial<SubprocessLimits>> = Object.freeze({
  timeoutMs: 30_000,
  stdoutMaxBytes: 1_048_576,
  stderrMaxBytes: 65_536,
})

const IDENTITY_LIMITS: Readonly<Partial<SubprocessLimits>> = Object.freeze({
  timeoutMs: 10_000,
  stdoutMaxBytes: 16_384,
  stderrMaxBytes: 16_384,
})

const IMPORT_IDENTITY_SCRIPT = String.raw`
import json
import os
import sys
import marivo

actual = {
    "python_executable": os.path.abspath(sys.executable),
    "marivo_version": marivo.__version__,
    "package_path": os.path.abspath(marivo.__file__ or ""),
}
expected = {
    "python_executable": os.path.abspath(sys.argv[1]),
    "marivo_version": sys.argv[2],
    "package_path": os.path.abspath(sys.argv[3]),
}
if actual != expected:
    print(json.dumps({"kind": "identity-mismatch", "actual": actual}), file=sys.stderr)
    raise SystemExit(78)
print(json.dumps(actual, sort_keys=True))
`.trim()

const CHECKED_HELP_SCRIPT = String.raw`
import json
import os
import sys
import marivo

actual = {
    "python_executable": os.path.abspath(sys.executable),
    "marivo_version": marivo.__version__,
    "package_path": os.path.abspath(marivo.__file__ or ""),
}
expected = {
    "python_executable": os.path.abspath(sys.argv[1]),
    "marivo_version": sys.argv[2],
    "package_path": os.path.abspath(sys.argv[3]),
}
if actual != expected:
    print(json.dumps({"kind": "identity-mismatch", "actual": actual}), file=sys.stderr)
    raise SystemExit(78)
marivo.help(sys.argv[4])
`.trim()

const CHECKED_DATASOURCE_DESCRIBE_SCRIPT = String.raw`
import json
import os
import sys
import marivo
import marivo.datasource as md

actual = {
    "python_executable": os.path.abspath(sys.executable),
    "marivo_version": marivo.__version__,
    "package_path": os.path.abspath(marivo.__file__ or ""),
}
expected = {
    "python_executable": os.path.abspath(sys.argv[1]),
    "marivo_version": sys.argv[2],
    "package_path": os.path.abspath(sys.argv[3]),
}
if actual != expected:
    print(json.dumps({"kind": "identity-mismatch", "actual": actual}), file=sys.stderr)
    raise SystemExit(78)
description = md.describe(sys.argv[4])
print(json.dumps({
    "name": description.name,
    "refs": list(description.env_refs.values()),
}, sort_keys=True))
`.trim()

const CHECKED_DATASOURCE_INVENTORY_SCRIPT = String.raw`
import json
import os
import sys
import marivo
import marivo.datasource as md

actual = {
    "python_executable": os.path.abspath(sys.executable),
    "marivo_version": marivo.__version__,
    "package_path": os.path.abspath(marivo.__file__ or ""),
}
expected = {
    "python_executable": os.path.abspath(sys.argv[1]),
    "marivo_version": sys.argv[2],
    "package_path": os.path.abspath(sys.argv[3]),
}
if actual != expected:
    print(json.dumps({"kind": "identity-mismatch", "actual": actual}), file=sys.stderr)
    raise SystemExit(78)
print(json.dumps({
    "datasources": [{
        "name": description.name,
        "refs": list(description.env_refs.values()),
    } for description in (md.describe(item.name) for item in md.list())],
}, sort_keys=True))
`.trim()

const CHECKED_DATASOURCE_TEST_SCRIPT = String.raw`
import contextlib
import io
import json
import os
import sys
import marivo
import marivo.datasource as md

actual = {
    "python_executable": os.path.abspath(sys.executable),
    "marivo_version": marivo.__version__,
    "package_path": os.path.abspath(marivo.__file__ or ""),
}
expected = {
    "python_executable": os.path.abspath(sys.argv[1]),
    "marivo_version": sys.argv[2],
    "package_path": os.path.abspath(sys.argv[3]),
}
if actual != expected:
    print(json.dumps({"kind": "identity-mismatch", "actual": actual}), file=sys.stderr)
    raise SystemExit(78)
captured_stdout = io.StringIO()
captured_stderr = io.StringIO()
try:
    with contextlib.redirect_stdout(captured_stdout), contextlib.redirect_stderr(captured_stderr):
        description = md.describe(sys.argv[4])
        secret_values = [
            value
            for ref in description.env_refs.values()
            if (value := os.environ.get(ref))
        ]
        result = md.test(sys.argv[4])
except Exception as exc:
    print(json.dumps({"kind": "datasource-test-failed", "exception_type": type(exc).__name__}), file=sys.stderr)
    raise SystemExit(70)

def redact(value):
    if isinstance(value, str):
        for secret in secret_values:
            value = value.replace(secret, "[REDACTED]")
        return value
    if isinstance(value, list):
        return [redact(item) for item in value]
    if isinstance(value, tuple):
        return [redact(item) for item in value]
    if isinstance(value, dict):
        return {key: redact(item) for key, item in value.items()}
    return value

failure = None if result.failure is None else {
    "code": result.failure.code,
    "exception_type": result.failure.exception_type,
    "backend_code": result.failure.backend_code,
    "backend_name": result.failure.backend_name,
    "message": result.failure.message,
}
repair = None if result.repair is None else result.repair.model_dump(mode="json")
print(json.dumps(redact({
    "name": result.name,
    "ok": result.ok,
    "latency_ms": result.latency_ms,
    "failure": failure,
    "repair": repair,
}), sort_keys=True))
`.trim()

const CHECKED_EVIDENCE_FINDINGS_SCRIPT = String.raw`
import json
import os
import sys
import marivo
import marivo.analysis as mv

actual = {
    "python_executable": os.path.abspath(sys.executable),
    "marivo_version": marivo.__version__,
    "package_path": os.path.abspath(marivo.__file__ or ""),
}
expected = {
    "python_executable": os.path.abspath(sys.argv[1]),
    "marivo_version": sys.argv[2],
    "package_path": os.path.abspath(sys.argv[3]),
}
if actual != expected:
    print(json.dumps({"kind": "identity-mismatch", "actual": actual}), file=sys.stderr)
    raise SystemExit(78)

session_id = sys.argv[4]
finding_ids = json.loads(sys.argv[5])
try:
    session = mv.session.resume(session_id, use_datasources=False)
    findings = [session.evidence.finding(finding_id) for finding_id in finding_ids]
except Exception as exc:
    print(json.dumps({
        "kind": "evidence-read-failed",
        "exception_type": type(exc).__name__,
    }, sort_keys=True), file=sys.stderr)
    raise SystemExit(70)

print(json.dumps({
    "session_id": session.id,
    "findings": [{
        "finding_id": finding.finding_id,
        "finding_type": finding.finding_type,
        "epistemic_kind": finding.epistemic_kind,
        "artifact_id": finding.artifact_id,
        "session_id": finding.session_id,
        "canonical_item_key": finding.canonical_item_key,
        "quality_status": finding.quality_status,
        "committed_at": finding.committed_at.isoformat(),
        "extractor_version": finding.extractor_version,
        "artifact_schema_version": finding.artifact_schema_version,
    } for finding in findings],
}, sort_keys=True))
`.trim()

const CHECKED_REPORT_PROJECTION_SCRIPT = String.raw`
import datetime
import json
import math
import numbers
import os
import sys
import marivo
import marivo.analysis as mv

actual = {
    "python_executable": os.path.abspath(sys.executable),
    "marivo_version": marivo.__version__,
    "package_path": os.path.abspath(marivo.__file__ or ""),
}
expected = {
    "python_executable": os.path.abspath(sys.argv[1]),
    "marivo_version": sys.argv[2],
    "package_path": os.path.abspath(sys.argv[3]),
}
if actual != expected:
    print(json.dumps({"kind": "identity-mismatch", "actual": actual}), file=sys.stderr)
    raise SystemExit(78)

session_id = sys.argv[4]
artifact_refs = json.loads(sys.argv[5])
finding_groups = json.loads(sys.argv[6])
finding_ids = []
for group in finding_groups:
    for finding_id in group:
        if finding_id not in finding_ids:
            finding_ids.append(finding_id)

class ProjectionProblem(Exception):
    def __init__(self, code, location, message, repair):
        self.issue = {
            "code": code,
            "location": location,
            "message": message,
            "repair": repair,
        }

def blocked(issue):
    print(json.dumps({"status": "blocked", "issues": [issue]}, ensure_ascii=False, allow_nan=False, sort_keys=True))

def normalize_cell(value, location, nullable):
    if value is None or (type(value).__module__.startswith("pandas") and type(value).__name__ in {"NAType", "NaTType"}):
        if nullable:
            return None
        raise ProjectionProblem(
            "unexpected-null-cell", location,
            "Artifact contains a null value in a non-nullable public column.",
            "Regenerate the Artifact so its values match the public nullable contract.",
        )
    if isinstance(value, (datetime.datetime, datetime.date)):
        return value.isoformat()
    if isinstance(value, str) or isinstance(value, bool):
        return value
    if isinstance(value, numbers.Integral):
        return int(value)
    if isinstance(value, numbers.Real):
        result = float(value)
        if math.isnan(result):
            if nullable:
                return None
            raise ProjectionProblem(
                "unexpected-null-cell", location,
                "Artifact contains a missing numeric value in a non-nullable public column.",
                "Regenerate the Artifact so its values match the public nullable contract.",
            )
        if not math.isfinite(result):
            raise ProjectionProblem(
                "non-finite-cell", location,
                "Artifact contains a non-finite numeric display value.",
                "Produce an Artifact with finite display values before rendering a report.",
            )
        return result
    raise ProjectionProblem(
        "unsupported-cell", location,
        "Artifact contains a display value that cannot be projected as a JSON scalar.",
        "Produce an Artifact with string, boolean, finite numeric, date/time, or null display values.",
    )

def analysis_issue(exc):
    repair = getattr(exc, "repair", None)
    action = getattr(repair, "action", None)
    return {
        "code": "marivo-" + str(getattr(exc, "kind", type(exc).__name__)).lower(),
        "location": str(getattr(exc, "location", None) or "marivo"),
        "message": str(getattr(exc, "message", str(exc))),
        "repair": str(action or "Repair the Marivo Session or exact reference, then submit the complete report again."),
    }

try:
    session = mv.session.resume(session_id, use_datasources=False)
    artifacts = []
    for artifact_index, requested_ref in enumerate(artifact_refs):
        frame = session.get_frame(requested_ref)
        contract = frame.contract()
        if frame.ref != requested_ref or contract.ref != requested_ref:
            raise ProjectionProblem(
                "non-canonical-artifact-ref", f"artifact_refs[{artifact_index}]",
                "Artifact reference did not resolve to the same canonical ref.",
                "Use the exact frame.ref returned by Marivo.",
            )
        result = session.revalidate(frame)
        if result.status != "admissible":
            raise ProjectionProblem(
                "artifact-not-admissible", f"artifact_refs[{artifact_index}]",
                f"Artifact {requested_ref!r} revalidation is {result.status!r}.",
                "Regenerate or repair the Artifact until session.revalidate(frame).status is admissible.",
            )
        if frame.shape[0] > 2000:
            raise ProjectionProblem(
                "artifact-row-limit", f"artifact_refs[{artifact_index}]",
                f"Artifact {requested_ref!r} has {frame.shape[0]} rows; the report limit is 2000.",
                "Produce a bounded Marivo Artifact with at most 2000 rows.",
            )
        content_hash = frame.state.content_hash
        if not content_hash or result.content_hash != content_hash:
            raise ProjectionProblem(
                "artifact-identity-drift", f"artifact_refs[{artifact_index}]",
                "Artifact content identity changed during report projection.",
                "Recover and revalidate the exact Artifact again before retrying.",
            )
        dataframe = frame.to_pandas()
        schema = contract.artifact_schema
        column_names = [column.name for column in schema.columns]
        if list(dataframe.columns) != column_names or tuple(dataframe.shape) != tuple(frame.shape):
            raise ProjectionProblem(
                "artifact-projection-drift", f"artifact_refs[{artifact_index}]",
                "Artifact terminal projection does not match its public contract and shape.",
                "Regenerate the Artifact and retry with its canonical ref.",
            )
        units = {}
        measures_meta = getattr(frame, "measures_meta", None)
        if callable(measures_meta):
            for measure in measures_meta():
                if isinstance(measure, dict) and isinstance(measure.get("column"), str) and isinstance(measure.get("unit"), str) and measure["unit"]:
                    units[measure["column"]] = measure["unit"]
        meta_unit = getattr(frame.meta, "unit", None)
        value_columns = [column.name for column in schema.columns if column.role in {"value", "measure"}]
        if isinstance(meta_unit, str) and meta_unit and len(value_columns) == 1:
            units.setdefault(value_columns[0], meta_unit)
        rows = [
            [normalize_cell(value, f"artifacts[{artifact_index}].rows[{row_index}][{column_index}]", schema.columns[column_index].nullable) for column_index, value in enumerate(row)]
            for row_index, row in enumerate(dataframe.itertuples(index=False, name=None))
        ]
        artifacts.append({
            "ref": frame.ref,
            "family": contract.kind,
            "shape": list(frame.shape),
            "columns": [{**column.model_dump(mode="json"), "unit": units.get(column.name)} for column in schema.columns],
            "content_hash": content_hash,
            "artifact_schema_version": result.artifact_schema_version,
            "created_at": frame.meta.created_at.isoformat(),
            "contract": contract.model_dump(mode="json"),
            "revalidation": result.model_dump(mode="json"),
            "lineage": frame.meta.lineage.model_dump(mode="json"),
            "rows": rows,
        })

    findings = [session.evidence.finding(finding_id) for finding_id in finding_ids]
    compatibilities = []
    for group_index, group in enumerate(finding_groups):
        compatibility = session.evidence.compatibility(finding_ids=group)
        if compatibility.status != "compatible":
            raise ProjectionProblem(
                "evidence-not-compatible", f"finding_groups[{group_index}]",
                f"Finding compatibility is {compatibility.status!r} for one report block.",
                "Use a mechanically compatible Finding selection for that block, or remove the incompatible references.",
            )
        compatibilities.append({
            "group_index": group_index,
            "status": compatibility.status,
            "finding_ids": list(compatibility.finding_ids),
            "value": compatibility.model_dump(mode="json"),
        })
    payload = {
        "status": "ready",
        "session_id": session.id,
        "artifacts": artifacts,
        "findings": [{
            "finding_id": finding.finding_id,
            "finding_type": finding.finding_type,
            "epistemic_kind": finding.epistemic_kind,
            "artifact_id": finding.artifact_id,
            "session_id": finding.session_id,
            "quality_status": finding.quality_status,
            "committed_at": finding.committed_at.isoformat(),
            "value": finding.value.model_dump(mode="json"),
            "subject": finding.subject.model_dump(mode="json"),
            "derivation": finding.derivation.model_dump(mode="json"),
        } for finding in findings],
        "compatibilities": compatibilities,
    }
    encoded = json.dumps(payload, ensure_ascii=False, allow_nan=False, separators=(",", ":"), sort_keys=True).encode("utf-8")
    if len(encoded) > 16 * 1024 * 1024:
        raise ProjectionProblem(
            "projection-too-large", "marivo.projection",
            "The checked Marivo report projection exceeds 16 MiB.",
            "Reduce referenced rows, columns, Artifacts, or Findings before retrying.",
        )
except ProjectionProblem as exc:
    blocked(exc.issue)
    raise SystemExit(0)
except mv.errors.AnalysisError as exc:
    blocked(analysis_issue(exc))
    raise SystemExit(0)
except Exception as exc:
    print(json.dumps({
        "kind": "report-projection-failed",
        "exception_type": type(exc).__name__,
    }, sort_keys=True), file=sys.stderr)
    raise SystemExit(70)

sys.stdout.buffer.write(encoded)
`.trim()

function redactSubprocessOutput(
  result: Awaited<ReturnType<FixedSubprocessPolicy['run']>>,
  environmentOverlay: Readonly<NodeJS.ProcessEnv> | undefined,
) {
  if (environmentOverlay === undefined) return result
  const secrets = Object.values(environmentOverlay).filter(
    (value): value is string => value !== undefined && value !== '',
  )
  const redactText = (source: string): string => {
    let text = source
    for (const secret of secrets) text = text.split(secret).join('[REDACTED]')
    return text
  }
  const redactJsonValue = (value: unknown): unknown => {
    if (typeof value === 'string') return redactText(value)
    if (Array.isArray(value)) return value.map(redactJsonValue)
    if (typeof value !== 'object' || value === null) return value
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, redactJsonValue(item)]),
    )
  }
  const redactStdout = (): Buffer => {
    const text = result.stdout.toString('utf8')
    try {
      return Buffer.from(JSON.stringify(redactJsonValue(JSON.parse(text))))
    } catch {
      return Buffer.from(redactText(text))
    }
  }
  return {
    ...result,
    stdout: redactStdout(),
    stderr: Buffer.from(redactText(result.stderr.toString('utf8'))),
  }
}

function normalizeAbsolute(value: string): string {
  return path.normalize(path.resolve(value))
}

async function assertProjectRoot(projectRoot: string): Promise<string> {
  const resolved = normalizeAbsolute(projectRoot)
  try {
    const info = await stat(resolved)
    if (!info.isDirectory()) throw new Error('not a directory')
    return await realpath(resolved)
  } catch (cause) {
    throw new MarivoEnvironmentError(
      'project-root-invalid',
      `Marivo project root is not an existing directory: ${resolved}`,
      { projectRoot: resolved },
      { cause },
    )
  }
}

async function assertExecutable(executable: string): Promise<void> {
  try {
    const info = await stat(executable)
    if (!info.isFile()) throw new Error('not a file')
    await access(executable, process.platform === 'win32' ? constants.F_OK : constants.X_OK)
  } catch (cause) {
    throw new MarivoEnvironmentError(
      'python-unavailable',
      `Marivo Python executable is missing or not executable: ${executable}`,
      { pythonExecutable: executable },
      { cause },
    )
  }
}

async function resolvePythonExecutable(
  projectRoot: string,
  configured: string | undefined,
): Promise<string> {
  if (configured !== undefined && !path.isAbsolute(configured)) {
    throw new MarivoEnvironmentError(
      'python-path-relative',
      `Configured Marivo Python executable must be absolute: ${configured}`,
      { pythonExecutable: configured },
    )
  }
  const executable = configured === undefined
    ? path.join(projectRoot, process.platform === 'win32' ? '.venv/Scripts/python.exe' : '.venv/bin/python')
    : path.normalize(configured)
  await assertExecutable(executable)
  return executable
}

function fingerprint(binding: Omit<MarivoEnvironmentBinding, 'fingerprint'>): string {
  const payload = [
    binding.projectRoot,
    binding.pythonExecutable,
    binding.marivoVersion,
    binding.packagePath,
    binding.subprocessPolicyId,
  ]
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex')
}

function parseImportIdentity(stdout: Buffer): ImportIdentity {
  try {
    const value = JSON.parse(stdout.toString('utf8')) as Record<string, unknown>
    if (
      typeof value.python_executable !== 'string'
      || typeof value.marivo_version !== 'string'
      || typeof value.package_path !== 'string'
    ) throw new TypeError('identity fields must be strings')
    return {
      pythonExecutable: value.python_executable,
      marivoVersion: value.marivo_version,
      packagePath: value.package_path,
    }
  } catch (cause) {
    throw new MarivoEnvironmentError(
      'binding-identity-mismatch',
      'Marivo import identity probe returned an invalid payload; explicit rebind is required',
      { stdoutBytes: stdout.byteLength },
      { cause },
    )
  }
}

/** A ready binding and the single frozen subprocess policy that established it. */
export class MarivoEnvironment {
  readonly binding: Readonly<MarivoEnvironmentBinding>
  readonly subprocessPolicy: FixedSubprocessPolicy
  #failed = false

  constructor(
    binding: MarivoEnvironmentBinding,
    subprocessPolicy: FixedSubprocessPolicy,
  ) {
    this.binding = Object.freeze({ ...binding })
    this.subprocessPolicy = subprocessPolicy
  }

  get status(): 'ready' | 'failed' {
    return this.#failed ? 'failed' : 'ready'
  }

  /**
   * Run the same-process assertion that future inventory/focused-help runners must execute before
   * rendering help. A mismatch permanently fails this binding.
   */
  async assertImportIdentity(signal?: AbortSignal): Promise<ImportIdentity> {
    if (this.#failed) {
      throw new MarivoEnvironmentError(
        'binding-failed',
        'Marivo Environment Binding has failed; explicit rebind is required',
        { fingerprint: this.binding.fingerprint },
      )
    }
    const result = await this.subprocessPolicy.run({
      executable: this.binding.pythonExecutable,
      args: [
        '-c',
        IMPORT_IDENTITY_SCRIPT,
        this.binding.pythonExecutable,
        this.binding.marivoVersion,
        this.binding.packagePath,
      ],
      limits: IDENTITY_LIMITS,
      signal,
    })
    if (result.exitCode !== 0) {
      this.#failed = true
      throw new MarivoEnvironmentError(
        'binding-identity-mismatch',
        'Marivo import identity changed; explicit rebind is required',
        {
          fingerprint: this.binding.fingerprint,
          exitCode: result.exitCode,
          stderr: result.stderr.toString('utf8').slice(0, 2_000),
        },
      )
    }
    try {
      const identity = parseImportIdentity(result.stdout)
      if (
        normalizeAbsolute(identity.pythonExecutable) !== normalizeAbsolute(this.binding.pythonExecutable)
        || identity.marivoVersion !== this.binding.marivoVersion
        || normalizeAbsolute(identity.packagePath) !== normalizeAbsolute(this.binding.packagePath)
      ) throw new Error('identity values differ from binding')
      return identity
    } catch (cause) {
      this.#failed = true
      if (cause instanceof MarivoEnvironmentError) throw cause
      throw new MarivoEnvironmentError(
        'binding-identity-mismatch',
        'Marivo import identity changed; explicit rebind is required',
        { fingerprint: this.binding.fingerprint },
        { cause },
      )
    }
  }

  /**
   * Execute one real `marivo.help(target)` only after an in-process identity assertion. The
   * assertion and render share one Python process, removing a check/use race. Ordinary Marivo
   * target failures do not poison the binding; identity exit 78 does.
   */
  async runCheckedHelpTarget(
    target: string,
    limits: Partial<SubprocessLimits>,
    signal?: AbortSignal,
  ) {
    if (this.#failed) {
      throw new MarivoEnvironmentError(
        'binding-failed',
        'Marivo Environment Binding has failed; explicit rebind is required',
        { fingerprint: this.binding.fingerprint },
      )
    }
    const result = await this.subprocessPolicy.run({
      executable: this.binding.pythonExecutable,
      args: [
        '-c',
        CHECKED_HELP_SCRIPT,
        this.binding.pythonExecutable,
        this.binding.marivoVersion,
        this.binding.packagePath,
        target,
      ],
      limits,
      signal,
    })
    if (result.exitCode === 78) {
      this.#failed = true
      throw new MarivoEnvironmentError(
        'binding-identity-mismatch',
        'Marivo import identity changed; explicit rebind is required',
        {
          fingerprint: this.binding.fingerprint,
          exitCode: result.exitCode,
          stderr: result.stderr.toString('utf8').slice(0, 2_000),
        },
      )
    }
    return result
  }

  async #runCheckedDatasourceScript(
    script: string,
    name: string,
    limits: Partial<SubprocessLimits>,
    environmentOverlay?: Readonly<NodeJS.ProcessEnv>,
    signal?: AbortSignal,
  ) {
    if (this.#failed) {
      throw new MarivoEnvironmentError(
        'binding-failed',
        'Marivo Environment Binding has failed; explicit rebind is required',
        { fingerprint: this.binding.fingerprint },
      )
    }
    const rawResult = await this.subprocessPolicy.run({
      executable: this.binding.pythonExecutable,
      args: [
        '-c',
        script,
        this.binding.pythonExecutable,
        this.binding.marivoVersion,
        this.binding.packagePath,
        name,
      ],
      ...(environmentOverlay === undefined ? {} : { environmentOverlay }),
      limits,
      signal,
    })
    const result = redactSubprocessOutput(rawResult, environmentOverlay)
    if (result.exitCode === 78) {
      this.#failed = true
      throw new MarivoEnvironmentError(
        'binding-identity-mismatch',
        'Marivo import identity changed; explicit rebind is required',
        { fingerprint: this.binding.fingerprint, exitCode: result.exitCode },
      )
    }
    return result
  }

  /** Return only the credential reference names declared by `md.describe(name)`. */
  runCheckedDatasourceDescribe(
    name: string,
    limits: Partial<SubprocessLimits>,
    signal?: AbortSignal,
  ) {
    return this.#runCheckedDatasourceScript(
      CHECKED_DATASOURCE_DESCRIBE_SCRIPT,
      name,
      limits,
      undefined,
      signal,
    )
  }

  /** Return datasource names and credential reference names for one Workspace. */
  runCheckedDatasourceInventory(
    limits: Partial<SubprocessLimits>,
    signal?: AbortSignal,
  ) {
    return this.#runCheckedDatasourceScript(
      CHECKED_DATASOURCE_INVENTORY_SCRIPT,
      '',
      limits,
      undefined,
      signal,
    )
  }

  /** Execute one real `md.test(name)` with a per-operation credential overlay. */
  runCheckedDatasourceTest(
    name: string,
    environmentOverlay: Readonly<NodeJS.ProcessEnv>,
    limits: Partial<SubprocessLimits>,
    signal?: AbortSignal,
  ) {
    return this.#runCheckedDatasourceScript(
      CHECKED_DATASOURCE_TEST_SCRIPT,
      name,
      limits,
      environmentOverlay,
      signal,
    )
  }

  /** Read exact persisted Findings without loading datasource definitions. */
  async runCheckedEvidenceFindings(
    sessionId: string,
    findingIds: readonly string[],
    limits: Partial<SubprocessLimits>,
    signal?: AbortSignal,
  ) {
    if (this.#failed) {
      throw new MarivoEnvironmentError(
        'binding-failed',
        'Marivo Environment Binding has failed; explicit rebind is required',
        { fingerprint: this.binding.fingerprint },
      )
    }
    const result = await this.subprocessPolicy.run({
      executable: this.binding.pythonExecutable,
      args: [
        '-c',
        CHECKED_EVIDENCE_FINDINGS_SCRIPT,
        this.binding.pythonExecutable,
        this.binding.marivoVersion,
        this.binding.packagePath,
        sessionId,
        JSON.stringify(findingIds),
      ],
      limits,
      signal,
    })
    if (result.exitCode === 78) {
      this.#failed = true
      throw new MarivoEnvironmentError(
        'binding-identity-mismatch',
        'Marivo import identity changed; explicit rebind is required',
        {
          fingerprint: this.binding.fingerprint,
          exitCode: result.exitCode,
          stderr: result.stderr.toString('utf8').slice(0, 2_000),
        },
      )
    }
    return result
  }

  /** Read and revalidate one all-or-nothing report projection without datasource access. */
  async runCheckedReportProjection(
    sessionId: string,
    artifactRefs: readonly string[],
    findingGroups: readonly (readonly string[])[],
    limits: Partial<SubprocessLimits>,
    signal?: AbortSignal,
  ) {
    if (this.#failed) {
      throw new MarivoEnvironmentError(
        'binding-failed',
        'Marivo Environment Binding has failed; explicit rebind is required',
        { fingerprint: this.binding.fingerprint },
      )
    }
    const result = await this.subprocessPolicy.run({
      executable: this.binding.pythonExecutable,
      args: [
        '-c',
        CHECKED_REPORT_PROJECTION_SCRIPT,
        this.binding.pythonExecutable,
        this.binding.marivoVersion,
        this.binding.packagePath,
        sessionId,
        JSON.stringify(artifactRefs),
        JSON.stringify(findingGroups),
      ],
      limits,
      signal,
    })
    if (result.exitCode === 78) {
      this.#failed = true
      throw new MarivoEnvironmentError(
        'binding-identity-mismatch',
        'Marivo import identity changed; explicit rebind is required',
        {
          fingerprint: this.binding.fingerprint,
          exitCode: result.exitCode,
          stderr: result.stderr.toString('utf8').slice(0, 2_000),
        },
      )
    }
    return result
  }
}

/** Resolve, probe, and establish one Marivo Environment Binding. */
export async function bindMarivoEnvironment(
  config: MarivoEnvironmentConfig,
  options: { environment?: NodeJS.ProcessEnv; signal?: AbortSignal } = {},
): Promise<MarivoEnvironment> {
  const projectRoot = await assertProjectRoot(config.projectRoot)
  const pythonExecutable = await resolvePythonExecutable(projectRoot, config.pythonExecutable)
  const subprocessPolicy = new FixedSubprocessPolicy(projectRoot, options.environment)
  const result = await subprocessPolicy.run({
    executable: pythonExecutable,
    args: ['-m', 'marivo', 'doctor', '--project-root', projectRoot, '--format', 'json'],
    limits: DOCTOR_LIMITS,
    signal: options.signal,
  })
  let report
  try {
    report = parseDoctorReport(result.stdout)
  } catch (cause) {
    if (cause instanceof MarivoEnvironmentError && cause.code === 'doctor-json-invalid') {
      throw new MarivoEnvironmentError(
        cause.code,
        cause.message,
        {
          ...cause.details,
          exitCode: result.exitCode,
          stderr: result.stderr.toString('utf8').slice(0, 2_000),
        },
        { cause },
      )
    }
    throw cause
  }
  admitDoctorReport(report, projectRoot, pythonExecutable)

  const partialBinding = {
    projectRoot,
    pythonExecutable,
    marivoVersion: report.marivo.version,
    packagePath: normalizeAbsolute(report.marivo.package_path),
    subprocessPolicyId: subprocessPolicy.id,
  }
  const binding: MarivoEnvironmentBinding = {
    ...partialBinding,
    fingerprint: fingerprint(partialBinding),
  }
  return new MarivoEnvironment(binding, subprocessPolicy)
}
