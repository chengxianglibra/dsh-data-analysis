import assert from 'node:assert/strict'
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { MARIVO_VERSION } from '../src/compatibility.ts'
import { PYTHON_LAUNCHER, PYTHON_WORKER } from '../src/datasource/resolver-program.ts'
import {
  ensureSharedMarivoRuntime,
  MarivoWorkspaceEnvironmentManager,
} from '../src/environment/index.ts'
import { createAnalysisDocument } from '../src/presentation/analysis.ts'
import { resultReference } from '../src/presentation/contracts/result-reference.ts'
import { parseSelectionText } from '../src/presentation/contracts/selection-text.ts'
import { isFrameSnapshotV2 } from '../src/presentation/contracts/snapshot.ts'
import { publishPresentation } from '../src/presentation/reports.ts'
import { readMarivoCandidates, readMarivoResult } from '../src/presentation/result-reader.ts'
import { analysisResultSummary } from '../src/presentation/result-summary.ts'
import { MarivoPresentationFileService } from '../src/presentation/rpc.ts'
import { readPythonResultOutput } from '../src/python-result-references.ts'

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
wide = mv.persist_dataframe(pd.DataFrame({f"amount_{i:03}": [i] for i in range(73)}))
print(json.dumps({"frame": frame.ref.to_dict(), "dataframe": reference.to_dict(), "empty": empty.to_dict(), "large": large.to_dict(), "wide": wide.to_dict()}))
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
  const frameValues = await readMarivoCandidates(runner, refs.frame, 'numericValues', 0, signal)
  assert.deepEqual(frameValues.candidates, ['amount'])
  const wide = resultReference.parse(raw.wide)
  const firstPage = await readMarivoCandidates(runner, wide, 'columns', 0, signal)
  assert.equal(firstPage.nextOffset, 12)
  assert.deepEqual(
    firstPage.candidates,
    Array.from({ length: 12 }, (_, i) => `amount_${String(i).padStart(3, '0')}`),
  )
  const lastPage = await readMarivoCandidates(runner, wide, 'columns', 72, signal)
  assert.deepEqual(lastPage.candidates, ['amount_072'])
  assert.equal(lastPage.nextOffset, null)
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
    /result-identity-mismatch/,
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
      resourcePatch: {
        put: {
          frame: { kind: 'analysis-frame', ref: raw.frame },
          data: { kind: 'dataframe', ref: raw.dataframe },
        },
      },
      program: 'root = Stack([AnalysisFrameView("frame"), DatasetView("data")]);',
    },
    { projectRoot: workspace, runner: async () => runner },
    { workspaceId: 'workspace', reportId: 'report', buildId: 'build' },
    signal,
  )
  // Exercise the real Python launcher/worker handoff with the same fixed results as the report.
  const resultVariables = { frame: 'frame', data: 'data' }
  const handoff = await runner.runChecked({
    program: PYTHON_LAUNCHER,
    stdin: JSON.stringify({
      worker: PYTHON_WORKER,
      identity: runner.binding,
      project_root: workspace,
      grants: {},
      values: {},
      projection_root: fileURLToPath(new URL('../python/presentation', import.meta.url)),
      result_variables: resultVariables,
      code: `import json\nframe = json.loads(${JSON.stringify(JSON.stringify(refs.frame))})\ndata = json.loads(${JSON.stringify(JSON.stringify(refs.dataframe))})`,
    }),
    signal,
  })
  assert.equal(handoff.exitCode, 0, handoff.stderr.toString())
  const exported = readPythonResultOutput(handoff.stderr.toString(), resultVariables)
  assert.deepEqual(exported.resultRefs, { frame: refs.frame, data: refs.dataframe })
  const reportMetadata = analysisResultSummary(document.resources)
  assert.equal(reportMetadata.status, 'captured')
  for (const name of ['frame', 'data']) {
    const metadata = exported.resultMetadata?.[name]
    assert.equal(metadata?.status, 'captured', `${name} metadata: ${JSON.stringify(metadata)}`)
    assert.deepEqual(metadata.viewCandidates, reportMetadata.resources[name]?.viewCandidates)
    assert.deepEqual(metadata.coordinateColumns, reportMetadata.resources[name]?.coordinateColumns)
  }
  await publishPresentation(workspace, document, null, async () => {}, signal, {
    kind: 'agent',
    sessionId: 'session',
    surface: 'tab',
  })
  const service = new MarivoPresentationFileService(() => ({ id: 'workspace', path: workspace }))
  try {
    for (const [resourceName, kind, expected] of [
      ['frame', 'frame', refs.frame],
      ['data', 'dataset', refs.dataframe],
    ] as const) {
      const request = {
        sessionId: 'session',
        workspaceId: 'workspace',
        recordId: document.recordId,
        resourceName,
        component: { kind },
      }
      const prepared = await service.component('component/prepare', request)
      assert('envelope' in prepared && prepared.envelope)
      const sent = await service.component('component/serialize', { envelope: prepared.envelope })
      assert('text' in sent && sent.text)
      const selection = parseSelectionText(sent.text)
      assert(selection)
      assert.deepEqual(selection.context.resultRef, expected)
      assert.equal('rows' in selection.context, false)
      assert.equal('report' in selection.context, false)
      // The actual submitted reference is sufficient for a new checked Marivo process.
      const restored = await readMarivoResult(
        runner,
        resultReference.parse(selection.context.resultRef),
        signal,
      )
      assert.deepEqual(restored.data, resourceName === 'frame' ? frame.data : dataframe.data)
    }
    for (const resourceName of ['frame', 'data']) {
      const request = {
        sessionId: 'session',
        workspaceId: 'workspace',
        recordId: document.recordId,
        resourceName,
        row: 0,
        field: 'amount',
      }
      const prepared =
        resourceName === 'frame'
          ? await service.point('point/prepare', request)
          : await service.dataset('dataset/prepare', request)
      assert('envelope' in prepared && prepared.envelope)
      const sent =
        resourceName === 'frame'
          ? await service.point('point/serialize', { envelope: prepared.envelope })
          : await service.dataset('dataset/serialize', { envelope: prepared.envelope })
      assert('text' in sent && sent.text)
      const selection = parseSelectionText(sent.text)
      assert.equal(
        selection?.context.value,
        resourceName === 'frame' ? '9007199254740993.1000' : '12345678901234.5678',
      )
      assert.deepEqual(
        selection?.context.resultRef,
        resourceName === 'frame' ? refs.frame : refs.dataframe,
      )
    }
  } finally {
    await service.close()
  }
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
    `${JSON.stringify({ status: 'ok', marivoVersion: runtime.marivoVersion, coldReads: ['AnalysisFrame', 'DataFrame'], selectionReferencesColdRead: true, selectionExactValues: true, exactValues: true, emptyDecimalType: true, boundedPreview: true, wrongStoreRejected: true, foreignWorkspaceRejected: true, savedResourcesIndependent: true, helperLibraryInstalled: false, httpService: false }, null, 2)}\n`,
  )
} finally {
  manager?.dispose()
  await rm(root, { recursive: true, force: true })
}
