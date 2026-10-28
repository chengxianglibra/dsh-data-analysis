"""Acceptance-side public persisted Frame identities and Evidence; no private Store reads."""
import json
import sys
import marivo.analysis as mv
import marivo.datasource as md
class Deny:
    def resolve(self, request):
        raise AssertionError("Persisted read requested credentials")
subjects = json.loads(sys.argv[1])
snapshots = []
with md.credential_scope(resolver=Deny()):
    for subject in subjects:
        session = mv.session.resume(subject["sessionId"])
        frame = session.persisted_frame(subject["artifactRef"])
        assert frame.session_id == subject["sessionId"] and frame.artifact_id == subject["artifactRef"]
        digest = frame.evidence_digest()
        snapshots.append(dict(**subject, createdAt=None, contract={"evidenceDigest":digest.evidence_digest,
            "findingCount":digest.finding_count, "artifactId":str(digest.artifact_ref)}))
print(json.dumps(snapshots, ensure_ascii=False))
