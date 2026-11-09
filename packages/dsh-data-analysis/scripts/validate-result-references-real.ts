import assert from 'node:assert/strict'
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { MARIVO_VERSION, MARIVO_WHEEL_SHA256 } from '../src/compatibility.ts'
import {
  ensureSharedMarivoRuntime,
  MarivoWorkspaceEnvironmentManager,
} from '../src/environment/index.ts'
import { createAnalysisDocument } from '../src/presentation/analysis.ts'
import { resultReference } from '../src/presentation/contracts/result-reference.ts'
import { isFrameSnapshotV2 } from '../src/presentation/contracts/snapshot.ts'
import { readMarivoResult } from '../src/presentation/result-reader.ts'

const root = await realpath(await mkdtemp(path.join(tmpdir(), 'dsh-result-references-')))
let manager: MarivoWorkspaceEnvironmentManager | undefined
try {
  const workspace = path.join(root, 'workspace')
  await mkdir(workspace)
  const runtime = await ensureSharedMarivoRuntime({
    runtimeRoot: path.join(root, 'runtime'),
    ...(process.env.DSH_DATA_ANALYSIS_PYTHON
      ? { pythonExecutable: process.env.DSH_DATA_ANALYSIS_PYTHON }
      : {}),
  })
  assert.equal(runtime.marivoVersion, MARIVO_VERSION)
  assert.equal(runtime.marivoArchiveSha256, MARIVO_WHEEL_SHA256)
  assert.deepEqual(
    await ensureSharedMarivoRuntime({
      runtimeRoot: runtime.runtimeRoot,
      pythonExecutable: process.env.DSH_DATA_ANALYSIS_PYTHON,
    }),
    runtime,
  )
  manager = new MarivoWorkspaceEnvironmentManager(runtime)
  const runner = await manager.resolve(workspace)
  const producer = await runner.runChecked({
    program: String.raw`
import importlib.util, json
from decimal import Decimal
import pandas as pd
import pyarrow as pa
import marivo.analysis as mv
assert importlib.util.find_spec("dsh_data_analysis_presentation") is None
session = mv.session.get_or_create("direct-result-reference")
frame = session.values(columns={"amount": "CNY"}, rows=(((), {"amount": Decimal("9007199254740993.1000")}),)).persist(description="Exact Frame")
reference = mv.persist_dataframe(pd.DataFrame({
    "account": pd.Series([9007199254740993, None], dtype="int64[pyarrow]"),
    "amount": pd.Series([Decimal("12345678901234.5678"), Decimal("0.1000")], dtype=pd.ArrowDtype(pa.decimal128(24, 4))),
}))
empty = mv.persist_dataframe(pd.DataFrame({"amount": pd.Series([], dtype=pd.ArrowDtype(pa.decimal128(24, 4)))}))
large = mv.persist_dataframe(pd.DataFrame({"n": range(5001)}))
print(json.dumps({"frame": frame.ref.to_dict(), "dataframe": reference.to_dict(), "empty": empty.to_dict(), "large": large.to_dict()}))
`,
    environmentOverlay: { MARIVO_TELEMETRY: 'off' },
  })
  assert.equal(producer.exitCode, 0, producer.stderr.toString())
  const raw = JSON.parse(producer.stdout.toString())
  const refs = {
    frame: resultReference.parse(raw.frame),
    dataframe: resultReference.parse(raw.dataframe),
    empty: resultReference.parse(raw.empty),
    large: resultReference.parse(raw.large),
  }
  const signal = new AbortController().signal
  // Each checked run is a new process; no producer objects or helper installation survive.
  const frame = await readMarivoResult(runner, refs.frame, signal)
  assert(isFrameSnapshotV2(frame))
  assert.deepEqual(frame.data.rows, [['9007199254740993.1000']])
  const inheritedProjectRunner = {
    binding: runner.binding,
    status: runner.status,
    runChecked: (request: Parameters<typeof runner.runChecked>[0]) =>
      runner.runChecked({
        ...request,
        program: `import os\nos.environ["MARIVO_PROJECT_ROOT"] = ${JSON.stringify(root)}\n${request.program}`,
      }),
  }
  assert.deepEqual(
    (await readMarivoResult(inheritedProjectRunner, refs.frame, signal)).data,
    frame.data,
  )
  const dataframe = await readMarivoResult(runner, refs.dataframe, signal)
  assert.deepEqual(dataframe.data.rows, [
    ['9007199254740993', '12345678901234.5678'],
    [null, '0.1000'],
  ])
  const empty = await readMarivoResult(runner, refs.empty, signal)
  assert.equal(empty.data.columns[0]?.type, 'decimal')
  assert.deepEqual(empty.data.rows, [])
  const large = await readMarivoResult(runner, refs.large, signal)
  assert.equal(large.data.rows.length, 5000)
  assert.equal(large.coverage.totalRows, 5001)
  assert.equal(large.coverage.complete, false)
  await assert.rejects(
    readMarivoResult(
      runner,
      resultReference.parse({ ...raw.frame, store_id: 'foreign-store' }),
      signal,
    ),
    /result-read-failed/,
  )
  await assert.rejects(
    readMarivoResult(
      runner,
      resultReference.parse({ ...raw.dataframe, project_root: root }),
      signal,
    ),
    /workspace-mismatch/,
  )
  await writeFile(
    path.join(workspace, 'presentation.py'),
    'raise AssertionError("Workspace projection shadow")\n',
  )
  assert.deepEqual((await readMarivoResult(runner, refs.dataframe, signal)).data, dataframe.data)
  const document = await createAnalysisDocument(
    {
      surface: 'tab',
      resources: {
        frame: { kind: 'analysis-frame', ref: raw.frame },
        data: { kind: 'dataframe', ref: raw.dataframe },
      },
      program: 'root = Stack([AnalysisFrameView("frame"), DatasetView("data")]);',
    },
    { projectRoot: workspace, runner: async () => runner },
    { workspaceId: 'workspace', reportId: 'report', buildId: 'build' },
    signal,
  )
  await rm(path.join(workspace, '.marivo'), { recursive: true, force: true })
  const updated = await createAnalysisDocument(
    { surface: 'tab', title: 'Retained result' },
    { projectRoot: workspace },
    { workspaceId: 'workspace', reportId: 'report', buildId: 'updated' },
    signal,
    document,
  )
  assert.deepEqual(updated.resources, document.resources)
  process.stdout.write(
    `${JSON.stringify({ status: 'ok', marivoVersion: runtime.marivoVersion, wheelSha256: runtime.marivoArchiveSha256, coldReads: ['AnalysisFrame', 'DataFrame'], exactValues: true, emptyDecimalType: true, boundedPreview: true, wrongStoreRejected: true, foreignWorkspaceRejected: true, savedResourcesIndependent: true, helperLibraryInstalled: false, httpService: false }, null, 2)}\n`,
  )
} finally {
  manager?.dispose()
  await rm(root, { recursive: true, force: true })
}
