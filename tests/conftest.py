import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
for p in [ROOT, ROOT / "src", ROOT / "data", ROOT / "worker" / "src", ROOT / "sandbox-worker" / "src"]:
    sys.path.insert(0, str(p))
