export const MARIVO_EVIDENCE_FINDINGS_PROGRAM = String.raw`
import json
import os
import sys
import marivo
import marivo.analysis as mv


session_id = sys.argv[1]
finding_ids = json.loads(sys.argv[2])
try:
    session = mv.session.resume(session_id, use_datasources=False)
    findings = [session.evidence.finding(finding_id) for finding_id in finding_ids]
except Exception as exc:
    print(json.dumps({
        "kind": "evidence-read-failed",
        "exception_type": type(exc).__name__,
    }, sort_keys=True), file=sys.stderr)
    raise SystemExit(70)

try:
    rendered = [{
        "en": finding.render(language="en"),
        "zh": finding.render(language="zh"),
    } for finding in findings]
except Exception as exc:
    print(json.dumps({
        "kind": "finding-render-failed",
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
        "rendered": rendered[index],
    } for index, finding in enumerate(findings)],
}, sort_keys=True))
`.trim()
