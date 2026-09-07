"""S0 public read spike; this is not a production presentation projection."""

import json
import math
import os
import sys
from datetime import datetime, timezone
from decimal import Decimal
from numbers import Integral, Real

import marivo.analysis as mv
import marivo.datasource as md
import pandas as pd
from marivo.analysis.errors import ArtifactNotFoundError


selection = json.loads(sys.argv[1])
row_limit = int(sys.argv[2])
if not 1 <= row_limit <= 100:
    raise ValueError("row_limit must be within the S0 budget 1..100")
calls = {"observe": 0, "revalidate": 0, "credentialResolve": 0}


class DenyCredentials:
    def resolve(self, request):
        calls["credentialResolve"] += 1
        raise AssertionError("Persisted read requested a datasource credential")


def prohibit_execution(frame, event, arg):
    if event == "call" and str(frame.f_globals.get("__name__", "")).startswith("marivo."):
        name = frame.f_code.co_name
        if name in ("observe", "revalidate"):
            calls[name] += 1
            raise AssertionError("Persisted read invoked " + name)


def cell(value):
    if value is None or pd.isna(value):
        return None
    if isinstance(value, Decimal):
        if not value.is_finite():
            raise ValueError("non-finite Decimal")
        return str(value)
    if isinstance(value, bool):
        return value
    if isinstance(value, Integral):
        return str(value)
    if isinstance(value, Real):
        if not math.isfinite(value):
            raise ValueError("non-finite number")
        return float(value)
    if isinstance(value, str):
        return value
    raise TypeError("unsupported public cell: " + type(value).__name__)


sys.setprofile(prohibit_execution)
with md.credential_scope(resolver=DenyCredentials()):
    session = mv.session.resume(selection["sessionId"], use_datasources=False)
    try:
        artifact = session.artifact(selection["artifactRef"])
    except ArtifactNotFoundError as exc:
        source_only = len(sys.argv) >= 4 and sys.argv[3] == "source-only"
        session.close()
        sys.setprofile(None)
        print(json.dumps({
            "status": "unavailable" if source_only else "error", "ref": selection,
            "reason": "The declared Artifact is not available in the bound Workspace Session.",
            "exceptionType": type(exc).__name__, "forbiddenCalls": calls,
        }), file=sys.stdout if source_only else sys.stderr)
        raise SystemExit(0 if source_only else 70)
    contract = artifact.contract()
    frame = artifact.to_pandas().sort_values("region", kind="stable")
    assert artifact.ref == selection["artifactRef"]
    assert artifact.meta.session_id == session.id == selection["sessionId"]
    assert contract.ref == artifact.ref
    assert [column.name for column in contract.artifact_schema.columns] == list(frame.columns)
    assert artifact.meta.row_count == len(frame)
    finding = artifact.finding(selection["findingId"])
    assert finding.artifact_ref == artifact.ref and finding.session_id == session.id
    meta = artifact.meta
    quality = meta.quality_summary
    source = {
        "sessionId": session.id,
        "artifactRef": artifact.ref,
        "kind": meta.kind,
        "createdAt": meta.created_at.isoformat(),
        "contentHash": meta.content_hash,
        "evidenceStatus": meta.evidence_status,
        "findingCount": meta.finding_count,
        "semanticInputs": [
            {
                "role": item.role,
                "kind": item.semantic_kind.value,
                "path": item.semantic_path,
                "outputColumn": item.output_column,
            }
            for item in contract.semantic_inputs
        ],
        "quality": None if quality is None else {
            "coverage": quality.coverage,
            "nullRate": quality.null_rate,
            "sampleSize": quality.sample_size,
            "evaluatedCheckCount": quality.evaluated_check_count,
            "failedCheckCount": quality.failed_check_count,
            "warningCheckCount": quality.warning_check_count,
        },
        "issues": [
            {"kind": issue.kind, "severity": issue.severity}
            for issue in contract.issues
        ],
        "finding": {
            "id": finding.finding_id,
            "type": finding.finding_type,
            "sourceRefs": list(finding.source_refs),
            "excerpt": finding.render(max_output_bytes=4096),
        },
        "definition": {
            "status": "unavailable",
            "reason": "S0 does not obtain a historical metric definition from the persisted Artifact public contract.",
        },
        "revalidation": {"status": "not_requested"},
    }
    result = {
        "schema": "dsh-data-analysis-presentation-s0-runtime/v1",
        "readPid": os.getpid(),
        "readAt": datetime.now(timezone.utc).isoformat(),
        "source": source,
        "columns": [
            {
                "name": item.name,
                "artifactDtype": item.dtype,
                "pandasDtype": str(frame.dtypes.iloc[index]),
                "nullable": item.nullable,
                "role": item.role,
                "pythonTypes": sorted({type(value).__name__ for value in frame.iloc[:, index]}),
            }
            for index, item in enumerate(contract.artifact_schema.columns)
        ],
        "rows": [[cell(value) for value in row] for row in frame.head(row_limit).itertuples(index=False, name=None)],
        "truncation": {
            "totalRows": len(frame), "writtenRows": min(len(frame), row_limit),
            "omittedRows": max(0, len(frame) - row_limit), "rowLimit": row_limit,
        },
        "readApi": ["mv.session.resume(use_datasources=False)", "session.artifact", "artifact.contract", "artifact.to_pandas", "artifact.finding", "finding.render"],
        "forbiddenCalls": calls,
    }
    session.close()
sys.setprofile(None)
print(json.dumps(result, ensure_ascii=False, allow_nan=False))
