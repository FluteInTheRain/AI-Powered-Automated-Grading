"""FastAPI entrypoint for the grading-sandbox Python Worker.

This Worker has no bindings, no vars and no public URL: the only thing reachable
from exec'd student code is nothing. The main Worker calls it via service binding.
"""
import sys
from pathlib import Path

# In the deployed bundle src/ is the root; the grader copy lives at src/vendor/grader.
sys.path.insert(0, str(Path(__file__).resolve().parent / "vendor"))

from fastapi import FastAPI, HTTPException  # noqa: E402

import handler  # noqa: E402

app = FastAPI()

_MODES = {"run", "cases", "reference"}


@app.post("/execute")
async def execute(payload: dict):
    if (
        payload.get("mode") not in _MODES
        or not isinstance(payload.get("code"), str)
        or not isinstance(payload.get("func_name"), str)
        or not isinstance(payload.get("cases"), list)
    ):
        raise HTTPException(status_code=400, detail="bad payload")
    try:
        return handler.execute(payload)
    except (ValueError, TypeError, KeyError) as e:
        raise HTTPException(status_code=400, detail=f"bad payload: {e}")


from workers import asgi  # noqa: E402

Default = asgi.entrypoint(app)
