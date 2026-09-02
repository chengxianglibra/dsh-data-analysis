export const MARIVO_EVIDENCE_FINDINGS_PROGRAM = String.raw`
import json
import sys
import marivo.analysis as mv
from marivo.analysis.errors import ArtifactNotFoundError, FindingNotFoundError


session_id = sys.argv[1]
selections = json.loads(sys.argv[2])
try:
    session = mv.session.resume(session_id, use_datasources=False)
except Exception as exc:
    print(json.dumps({
        "kind": "evidence-session-read-failed",
        "exception_type": type(exc).__name__,
    }, sort_keys=True), file=sys.stderr)
    raise SystemExit(70)


def revalidation_projection(artifact):
    try:
        result = session.revalidate(artifact.ref)
    except ArtifactNotFoundError:
        return {
            "status": "unavailable",
            "semantic_status": None,
            "evidence_status": None,
            "dependency_status": None,
        }
    return {
        "status": result.status,
        "semantic_status": result.semantic_status,
        "evidence_status": result.evidence_status,
        "dependency_status": result.dependency_status,
    }


sources = []
for selection in selections:
    artifact_ref = selection["artifactRef"]
    finding_id = selection["findingId"]
    locator = f"marivo://session/{session.id}/artifact/{artifact_ref}/finding/{finding_id}"
    try:
        artifact = session.artifact(artifact_ref)
    except Exception:
        sources.append({
            "status": "missing",
            "title": f"Missing Marivo Finding {finding_id}",
            "locator": locator,
            "excerpt": None,
            "truncated": False,
            "finding_id": finding_id,
            "finding_type": None,
            "epistemic_kind": None,
            "artifact_ref": artifact_ref,
            "session_id": session.id,
            "canonical_item_key": None,
            "committed_at": None,
            "source_refs": [],
            "revalidation": None,
        })
        continue
    except Exception:
        sources.append({
            "status": "unsupported",
            "title": f"Unavailable Marivo Finding {finding_id}",
            "locator": locator,
            "excerpt": None,
            "truncated": False,
            "finding_id": finding_id,
            "finding_type": None,
            "epistemic_kind": None,
            "artifact_ref": artifact_ref,
            "session_id": session.id,
            "canonical_item_key": None,
            "committed_at": None,
            "source_refs": [],
            "revalidation": None,
        })
        continue

    revalidation = revalidation_projection(artifact)
    try:
        finding = artifact.finding(finding_id)
    except FindingNotFoundError:
        sources.append({
            "status": "missing",
            "title": f"Missing Marivo Finding {finding_id}",
            "locator": locator,
            "excerpt": None,
            "truncated": False,
            "finding_id": finding_id,
            "finding_type": None,
            "epistemic_kind": None,
            "artifact_ref": artifact.ref,
            "session_id": session.id,
            "canonical_item_key": None,
            "committed_at": None,
            "source_refs": [],
            "revalidation": revalidation,
        })
        continue
    except Exception:
        sources.append({
            "status": "unsupported",
            "title": f"Unavailable Marivo Finding {finding_id}",
            "locator": locator,
            "excerpt": None,
            "truncated": False,
            "finding_id": finding_id,
            "finding_type": None,
            "epistemic_kind": None,
            "artifact_ref": artifact.ref,
            "session_id": session.id,
            "canonical_item_key": None,
            "committed_at": None,
            "source_refs": [],
            "revalidation": revalidation,
        })
        continue

    if finding.session_id != session.id or finding.artifact_ref != artifact.ref:
        print(json.dumps({"kind": "evidence-identity-mismatch"}, sort_keys=True), file=sys.stderr)
        raise SystemExit(70)

    try:
        excerpt = finding.render(max_output_bytes=4096)
        status = "available"
    except Exception:
        excerpt = None
        status = "unsupported"
    sources.append({
        "status": status,
        "title": f"{finding.finding_type} Finding: {finding.canonical_item_key}",
        "locator": locator,
        "excerpt": excerpt,
        "truncated": excerpt is not None and "output truncated at " in excerpt,
        "finding_id": finding.finding_id,
        "finding_type": finding.finding_type,
        "epistemic_kind": finding.epistemic_kind,
        "artifact_ref": finding.artifact_ref,
        "session_id": finding.session_id,
        "canonical_item_key": finding.canonical_item_key,
        "committed_at": finding.committed_at.isoformat(),
        "source_refs": list(finding.source_refs),
        "revalidation": revalidation,
    })

print(json.dumps({
    "session_id": session.id,
    "sources": sources,
}, sort_keys=True))
`.trim()
