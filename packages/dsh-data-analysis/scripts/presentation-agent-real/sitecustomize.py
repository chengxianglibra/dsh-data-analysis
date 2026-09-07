"""Read-only test observer: no Marivo imports, function replacement, or business data reads.

The runner copies this file to an isolated PYTHONPATH directory and fills LOG_PATH.
Only public Session call identities and successful returns are retained. This is
evidence of actual close execution, not an inference from generated source text.
"""

import atexit
import dis
import json
import os
import sys
import time

LOG_PATH = None  # Replaced in the isolated copy, never in the Runtime installation.
AGENT_CODE = False
_started = set()


def _emit(operation, **values):
    row = dict(timeMs=time.time_ns() // 1_000_000, pid=os.getpid(),
               cwd=os.getcwd(), operation=operation, agentCode=AGENT_CODE, **values)
    with open(LOG_PATH, "a", encoding="utf-8") as stream:
        stream.write(json.dumps(row, ensure_ascii=False) + "\n")


def _profile(frame, event, result):
    global AGENT_CODE
    code = frame.f_code
    if code.co_filename == "<marivo_python>" and code.co_name == "<module>" and event == "call":
        AGENT_CODE = True
        _emit("agent-code-start")
        return
    filename = code.co_filename.replace("\\", "/")
    if (event == "return" and
            filename.endswith(("/marivo/analysis/session/__init__.py",
                               "/marivo/analysis/session/_runtime.py")) and
            code.co_name in {"get_or_create", "resume", "create", "current"} and
            type(result).__name__ == "Session"):
        if dis.opname[code.co_code[frame.f_lasti]] in {"RETURN_VALUE", "RETURN_CONST"}:
            _started.add(id(result))
            _emit("acquire", method=code.co_name, sessionId=result.id, objectId=id(result))
        return
    if not filename.endswith("/marivo/analysis/session/core.py"):
        return
    receiver = frame.f_locals.get("self")
    if type(receiver).__name__ != "Session":
        return
    name = code.co_name
    if name not in {"__init__", "close", "observe", "compare", "attribute", "artifact"}:
        return
    if event == "call" and name == "close":
        _emit("close-call", sessionId=receiver.id, objectId=id(receiver))
    if event != "return":
        return
    # A profile 'return' also occurs during exception unwinding. Only retain
    # actual Python return instructions, without inspecting exception payloads.
    opcode = dis.opname[code.co_code[frame.f_lasti]]
    if opcode not in {"RETURN_VALUE", "RETURN_CONST"}:
        if name == "close":
            _emit("close-unwound", sessionId=receiver.id, objectId=id(receiver))
        return
    identity = dict(sessionId=receiver.id, objectId=id(receiver))
    # Construction includes Marivo's private recovery/preflight temporaries.
    # Only publicly returned Session handles establish caller close obligations.
    if name == "close":
        _started.discard(id(receiver))
    if name in {"observe", "compare", "attribute", "artifact"}:
        _started.add(id(receiver))
        identity["artifactRef"] = result.ref
    _emit(name, **identity)


if LOG_PATH is not None:
    _emit("process-start", executable=sys.executable)
    sys.setprofile(_profile)
    atexit.register(lambda: _emit("process-exit", unclosedObjectIds=sorted(_started)))
