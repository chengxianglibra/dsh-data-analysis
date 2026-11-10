import json

import pytest
from presentation import read_result


def test_busy_failure_uses_public_facts_and_never_leaks_exception_text(monkeypatch, capsys):
    class Busy(Exception):
        kind = "SessionBusy"
        location = "dataset.writer_guard"

    for error, code in [
        (Busy("private-path-and-secret"), "result-session-busy"),
        (ValueError("result-identity-mismatch"), "result-identity-mismatch"),
        (ValueError("private-path-and-secret"), "result-read-failed"),
        (RuntimeError("SessionBusyError private-path-and-secret"), "result-read-failed"),
    ]:
        def fail():
            raise error

        monkeypatch.setattr(read_result, "write_result", fail)
        with pytest.raises(SystemExit) as stopped:
            read_result.main()
        assert stopped.value.code == 1
        output = capsys.readouterr()
        assert json.loads(output.out) == {"error": {"code": code}}
        assert output.err == ""
