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
    session = mv.session.resume(selection["sessionId"])
    try:
        artifact = session.persisted_frame(selection["artifactRef"])
    except Exception as exc:
        source_only = len(sys.argv) >= 4 and sys.argv[3] == "source-only"
        sys.setprofile(None)
        print(json.dumps({"status": "unavailable" if source_only else "error", "ref": selection,
                          "exceptionType": type(exc).__name__, "forbiddenCalls": calls}),
              file=sys.stdout if source_only else sys.stderr)
        raise SystemExit(0 if source_only else 70)
    frame = artifact.to_pandas()
    frame = frame.sort_values(frame.columns[0], kind="stable")
    assert artifact.artifact_id == selection["artifactRef"]
    assert artifact.session_id == session.id == selection["sessionId"]
    digest = artifact.evidence_digest()
    assert str(digest.artifact_ref) == artifact.artifact_id
    result = {
        "schema": "dsh-data-analysis-presentation-s0-runtime/v1",
        "readPid": os.getpid(), "readAt": datetime.now(timezone.utc).isoformat(),
        "source": {"sessionId":session.id, "artifactRef":artifact.artifact_id,
                   "findingCount":digest.finding_count, "evidenceDigest":digest.evidence_digest},
        "columns": [{"name":name, "pandasDtype":str(frame[name].dtype)} for name in frame.columns],
        "rows": [[cell(value) for value in row] for row in frame.head(row_limit).itertuples(index=False, name=None)],
        "truncation": {"totalRows": len(frame), "writtenRows": min(len(frame), row_limit),
                       "omittedRows": max(0, len(frame)-row_limit), "rowLimit":row_limit},
        "readApi": ["mv.session.resume", "session.persisted_frame", "frame.to_pandas", "frame.evidence_digest"],
        "forbiddenCalls": calls,
    }
sys.setprofile(None)
print(json.dumps(result, ensure_ascii=False, allow_nan=False))
