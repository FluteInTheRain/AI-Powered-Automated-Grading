# The repo root has a Streamlit app.py, and pytest's rootdir sys.path insert
# puts the root ahead of worker/src, so `import app` would resolve to that file.
# Put worker/src first (and drop any cached `app`) so `app.store` is the Worker package.
import sys
from pathlib import Path

_WORKER_SRC = str(Path(__file__).resolve().parents[2] / "worker" / "src")
if sys.path[:1] != [_WORKER_SRC]:
    sys.path.insert(0, _WORKER_SRC)
_cached = sys.modules.get("app")
if _cached is not None and not hasattr(_cached, "__path__"):
    del sys.modules["app"]
