"""Acceptance-side public Artifact reads. Never queries a datasource or authors analysis."""

import json
import sys

import marivo.analysis as mv

subjects = json.loads(sys.argv[1])
snapshots = []
for identity in sorted({item["sessionId"] for item in subjects}):
    session = mv.session.resume(identity, by="id", use_datasources=False)
    try:
        for subject in subjects:
            if subject["sessionId"] != identity:
                continue
            artifact = session.artifact(subject["artifactRef"])
            snapshots.append(dict(**subject, createdAt=artifact.meta.created_at.isoformat(),
                                  contract=artifact.contract().model_dump(mode="json")))
    finally:
        session.close()
print(json.dumps(snapshots, ensure_ascii=False))
