"""Stand-in for the grading-sandbox Worker: reads a payload on stdin, runs
sandbox-worker/src/handler.py, writes [status, text] to argv[1]."""
import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
for p in (ROOT / "sandbox-worker" / "src", ROOT / "src"):
    sys.path.insert(0, str(p))

import grader.sandbox as gs  # noqa: E402
import handler  # noqa: E402

if os.environ.get("HOSTILE_TIME_LIMIT"):
    gs.TIME_LIMIT_S = float(os.environ["HOSTILE_TIME_LIMIT"])

payload = json.loads(sys.stdin.read())
try:
    answer = [200, json.dumps(handler.execute(payload))]
except handler.BadPayload as e:
    answer = [400, str(e)]
Path(sys.argv[1]).write_text(json.dumps(answer))
os._exit(0)
