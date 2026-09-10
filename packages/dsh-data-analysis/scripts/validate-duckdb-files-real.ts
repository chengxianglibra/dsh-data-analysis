import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { ensureSharedMarivoRuntime } from '../src/environment/index.ts'
import { FixedSubprocessPolicy } from '../src/environment/subprocess.ts'

// Fresh managed Runtime and isolated extension cache; no user Runtime is modified.
const root = await mkdtemp(path.join(tmpdir(), 'dsh-duckdb-files-'))
try {
  const runtime = await ensureSharedMarivoRuntime({ runtimeRoot: path.join(root, 'runtime') })
  const result = await new FixedSubprocessPolicy(root).run({
    executable: runtime.pythonExecutable,
    args: [
      '-c',
      String.raw`
import json
from importlib.metadata import distribution
from pathlib import Path
import duckdb
import ibis

root = Path.cwd()
# Verify the installed upstream metadata, not only the npm package specification.
requirements = distribution("marivo").requires or []
assert any("ibis-framework[duckdb]" in item and 'extra == "duckdb"' in item for item in requirements), requirements
con = ibis.duckdb.connect(extension_directory=str(root / "extensions"))
try:
    con.raw_sql("CREATE TABLE fixture AS SELECT * FROM (VALUES (1, 10), (2, 20), (3, 30)) t(id, amount)")
    # XLSX support is a DuckDB extension, not a separate Python extra.
    con.raw_sql("INSTALL excel")
    con.raw_sql("LOAD excel")
    formats = {"csv": "CSV, HEADER", "json": "JSON, ARRAY true", "parquet": "PARQUET", "xlsx": "XLSX, HEADER true"}
    results = {}
    for suffix, options in formats.items():
        con.raw_sql(f"COPY fixture TO 'fixture.{suffix}' (FORMAT {options})")
        reader = {"csv": "read_csv", "json": "read_json", "parquet": "read_parquet", "xlsx": "read_xlsx"}[suffix]
        # Ibis is the backend used by Marivo; verify both read and aggregate.
        frame = con.sql(f"SELECT count(*) AS n, sum(amount) AS total FROM {reader}('fixture.{suffix}')").execute()
        observed = {"rows": int(frame.iloc[0]["n"]), "total": int(frame.iloc[0]["total"])}
        assert observed == {"rows": 3, "total": 60}, (suffix, observed)
        results[suffix] = observed
    print(json.dumps({"duckdb": duckdb.__version__, "marivo": distribution("marivo").version, "formats": results}))
finally:
    con.disconnect()
`,
    ],
    limits: { timeoutMs: 180_000, stdoutMaxBytes: 16_384, stderrMaxBytes: 16_384 },
  })
  assert.equal(result.exitCode, 0, result.stderr.toString('utf8'))
  process.stdout.write(result.stdout)
} finally {
  await rm(root, { recursive: true, force: true })
}
