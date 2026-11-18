import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
for p in [ROOT, ROOT / "src", ROOT / "data", ROOT / "worker" / "src", ROOT / "sandbox-worker" / "src"]:
    sys.path.insert(0, str(p))

# worker/build.sh copies server/rules.py into worker/src/server/, which sits
# ahead of ROOT on sys.path. Import the repo's server package first so tests
# never run against a stale build copy.
sys.path.insert(0, str(ROOT))
import server  # noqa: E402,F401
sys.path.remove(str(ROOT))
assert Path(server.__file__).resolve().parent == ROOT / "server"
