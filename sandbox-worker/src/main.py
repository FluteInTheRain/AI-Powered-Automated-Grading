"""FastAPI entrypoint for the grading-sandbox Python Worker.

This Worker has no bindings, secrets or data for exec'd student code to reach.
Outbound fetch is an accepted risk. Expected values are never sent here: the
sandbox only returns outputs and the main Worker does the comparison.
"""
import json
import sys
from pathlib import Path

# In the deployed bundle src/ is the root; the grader copy lives at src/vendor/grader.
sys.path.insert(0, str(Path(__file__).resolve().parent / "vendor"))

from fastapi import FastAPI, HTTPException, Request  # noqa: E402

import handler  # noqa: E402

app = FastAPI()


@app.post("/execute")
async def execute(request: Request):
    try:
        payload = json.loads(await request.body())
        handler.validate(payload)
    except (ValueError, handler.BadPayload) as e:  # json errors and BadPayload only
        raise HTTPException(status_code=400, detail=f"bad payload: {e}")
    return handler.execute(payload)


from workers import asgi  # noqa: E402

Default = asgi.entrypoint(app)
