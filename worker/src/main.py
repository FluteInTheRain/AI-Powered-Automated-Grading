"""Entrypoint of the `grading` Python Worker: the FastAPI app behind /api/*.

Static frontend files are served by the assets binding (wrangler.jsonc), so
only /api/* requests reach this code. Bindings (DB, AI, SANDBOX, LLM_MODEL)
are read per request from request.scope["env"] in app.routes.
"""
import sys
from pathlib import Path

# In the deployed bundle src/ is the root; the grader copy lives at src/vendor/grader
# so that grader's Path(__file__).parents[2] / "prompts" is src/prompts.
sys.path.insert(0, str(Path(__file__).resolve().parent / "vendor"))

from fastapi import FastAPI  # noqa: E402

from app.routes import router  # noqa: E402

app = FastAPI()
app.include_router(router)


from workers import asgi  # noqa: E402

Default = asgi.entrypoint(app)
