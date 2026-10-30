"""Real Marivo Runtime acceptance; runs only with DSH_FRAME_REAL_PYTHON set to an isolated interpreter.

The interpreter must have the Marivo wheel and this kit installed. The test regenerates
every Frame fixture and compares it with the checked-in copy, ignoring identities that
differ per run (input, artifact and definition identities).
"""
import json
import os
import subprocess
from pathlib import Path

import pytest

PYTHON = os.environ.get("DSH_FRAME_REAL_PYTHON")
KIT = Path(__file__).resolve().parents[1]
FIXTURES = KIT.parents[1] / "tests" / "unified-analysis-ui" / "fixtures" / "frames"
VOLATILE = {"inputId", "artifactId", "definitionId"}

pytestmark = pytest.mark.skipif(not PYTHON, reason="DSH_FRAME_REAL_PYTHON is not set")


def _stable(value):
    if isinstance(value, dict):
        return {k: None if k in VOLATILE and v is not None else _stable(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_stable(v) for v in value]
    return value


def test_real_frames_match_the_checked_in_fixtures(tmp_path: Path):
    output = tmp_path / "frames"
    result = subprocess.run([PYTHON, "-I", str(KIT / "scripts" / "real_frames.py"), str(tmp_path / "work"), str(output)],
                            cwd=tmp_path, capture_output=True, text=True, timeout=600)
    assert result.returncode == 0, result.stderr[-4000:]
    index = json.loads(result.stdout)
    produced = sorted(p.name for p in output.glob("*.json"))
    assert produced == sorted(p.name for p in FIXTURES.glob("*.json"))
    for item in index["fixtures"]:
        assert set(item["sections"].values()) == {"captured"}, item
    for name in produced:
        actual = json.loads((output / name).read_text())
        assert actual["schemaVersion"] == 2 and actual["kind"] == "frame"
        assert str(tmp_path) not in (output / name).read_text()
        assert _stable(actual) == _stable(json.loads((FIXTURES / name).read_text())), name
