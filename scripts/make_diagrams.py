"""Generate the README diagrams as standalone SVG files with inlined icons.

Run from the repo root:  python3 scripts/make_diagrams.py
Writes docs/img/pipeline.svg and docs/img/teacher-app.svg.

GitHub renders an SVG used through <img> without loading anything external, so
every icon from docs/img/icons/ is inlined. Light and dark colours switch with
prefers-color-scheme inside the SVG.
"""
import re
from pathlib import Path
from xml.sax.saxutils import escape

ROOT = Path(__file__).resolve().parent.parent
ICONS = ROOT / "docs" / "img" / "icons"
OUT = ROOT / "docs" / "img"

STYLE = """
  :root { --bg:#ffffff; --node:#ffffff; --stroke:#d0d7de; --text:#1f2328; --muted:#656d76;
          --line:#6e7781; --group:#f6f8fa; --accent:#0969da; --warn:#cf222e; --disc:transparent; }
  @media (prefers-color-scheme: dark) {
    :root { --bg:#0d1117; --node:#161b22; --stroke:#3d444d; --text:#e6edf3; --muted:#9198a1;
            --line:#8b949e; --group:#10151c; --accent:#58a6ff; --warn:#ff7b72; --disc:#ece7dd; }
  }
  text { font-family: -apple-system, "Segoe UI", Helvetica, Arial, sans-serif; fill: var(--text); }
  .bg { fill: var(--bg); }
  .node { fill: var(--node); stroke: var(--stroke); stroke-width: 1.2; }
  .node.hot { stroke: var(--accent); stroke-width: 1.8; }
  .group { fill: var(--group); stroke: var(--stroke); stroke-width: 1.2; stroke-dasharray: 5 4; }
  .t { font-size: 13.5px; font-weight: 600; }
  .s { font-size: 11px; fill: var(--muted); }
  .lab { font-size: 11px; font-style: italic; fill: var(--muted); }
  .warn { font-size: 11.5px; fill: var(--warn); font-weight: 600; }
  .gl { font-size: 12px; font-weight: 700; fill: var(--muted); }
  .edge { fill: none; stroke: var(--line); stroke-width: 1.5; }
  .dash { stroke-dasharray: 5 4; }
  .disc { fill: var(--disc); }
"""


def icon(name: str, cx: float, cy: float, size: float = 28) -> str:
    svg = (ICONS / f"{name}.svg").read_text()
    view_box = re.search(r'viewBox="([^"]+)"', svg).group(1)
    inner = re.search(r"<svg[^>]*>(.*)</svg>", svg, re.S).group(1)
    r = size / 2
    return (
        f'<circle class="disc" cx="{cx}" cy="{cy}" r="{r + 4}"/>'
        f'<svg x="{cx - r}" y="{cy - r}" width="{size}" height="{size}" viewBox="{view_box}">{inner}</svg>'
    )


def node(x, cy, w, ico, title, sub=None, hot=False, h=58) -> str:
    y = cy - h / 2
    out = [f'<rect class="node{" hot" if hot else ""}" x="{x}" y="{y}" width="{w}" height="{h}" rx="9"/>']
    out.append(icon(ico, x + 28, cy))
    tx = x + 54
    if sub:
        out.append(f'<text class="t" x="{tx}" y="{cy - 4}">{escape(title)}</text>')
        out.append(f'<text class="s" x="{tx}" y="{cy + 13}">{escape(sub)}</text>')
    else:
        out.append(f'<text class="t" x="{tx}" y="{cy + 5}">{escape(title)}</text>')
    return "".join(out)


def edge(points, dashed=False) -> str:
    d = "M" + " L".join(f"{x},{y}" for x, y in points)
    return f'<path class="edge{" dash" if dashed else ""}" d="{d}" marker-end="url(#ah)"/>'


def label(x, y, text, cls="lab", anchor="start") -> str:
    return f'<text class="{cls}" x="{x}" y="{y}" text-anchor="{anchor}">{escape(text)}</text>'


def wrap(width, height, title, body) -> str:
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width} {height}" role="img" '
        f'aria-label="{escape(title)}">'
        f"<title>{escape(title)}</title><style>{STYLE}</style>"
        '<defs><marker id="ah" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" '
        'orient="auto-start-reverse"><path d="M0,1 L10,5 L0,9 z" fill="var(--line)"/></marker></defs>'
        f'<rect class="bg" width="{width}" height="{height}" rx="10"/>{body}</svg>'
    )


def pipeline() -> str:
    W = 220
    b = [
        node(20, 210, W, "file", "Student submission", "code + problem"),
        node(300, 60, W, "terminal", "Sandbox: run tests", "only source of correctness", hot=True),
        node(300, 190, W, "model", "LLM check: efficiency", "schema-constrained JSON"),
        node(300, 270, W, "model", "LLM check: code style", "schema-constrained JSON"),
        node(300, 350, W, "model", "LLM check: edge cases", "schema-constrained JSON"),
        node(590, 210, W, "scale", "aggregate()", "fixed weighted sum, Python", hot=True),
        node(850, 210, 150, "goal", "Final score", "0 to 100"),
        node(800, 350, 200, "idea", "LLM feedback text", "never changes the score"),
    ]
    for cy in (60, 190, 270, 350):
        b.append(edge([(240, 210), (270, 210), (270, cy), (300, cy)]))
    for cy in (60, 190, 270, 350):
        b.append(edge([(520, cy), (555, cy), (555, 210), (590, 210)]))
    b.append(label(528, 52, "pass rate"))
    b.append(edge([(810, 210), (850, 210)]))
    b.append(edge([(925, 239), (925, 321), (900, 321)], dashed=True))
    b.append(icon("stop", 322, 112, 20))
    b.append(label(340, 109, "0 tests pass or it does not compile:", "warn"))
    b.append(label(340, 125, "every dimension scores 0", "warn"))
    return wrap(1020, 400, "Grading pipeline: sandbox plus three LLM checks, fixed weighted sum", "".join(b))


def teacher_app() -> str:
    W = 210
    cA, cG, cR = 20, 280, 870  # left, middle, right column left edges
    gx = 545  # nodes inside the Worker group
    b = ['<rect class="group" x="525" y="34" width="250" height="298" rx="12"/>']
    b.append(label(540, 54, "teacher-app Worker (TypeScript, Hono)", "gl"))
    b += [
        node(cA, 100, 190, "user", "Teacher", "logs in"),
        node(cG, 100, 190, "shield", "Cloudflare Access", "verifies the JWT"),
        node(cA, 220, 190, "users", "Student", "opens the exam link"),
        node(cG, 220, 190, "stop", "Turnstile + limits", "bot check, rate limits"),
        node(gx, 110, W, "web", "API + React UI", "Hono, static assets", hot=True),
        node(gx, 200, W, "stream", "Queues", "one message per question"),
        node(gx, 290, W, "worker", "Queue consumer", "grades each question", hot=True),
        node(cR, 80, 210, "timer", "Durable Object", "per attempt: clock + lock"),
        node(cR, 200, 210, "db", "D1", "exams, scores, jobs"),
        node(20, 440, 210, "log", "R2", "LLM audit log"),
        node(gx, 440, W, "cloudflare", "Grading Worker", "Python, Pyodide"),
        node(cR, 410, 210, "lock", "Sandbox Worker", "no bindings, no URL"),
        node(cR, 490, 210, "model", "Workers AI", "schema-constrained LLM"),
    ]
    b += [
        edge([(210, 100), (280, 100)]),
        edge([(470, 100), (545, 100)]),
        edge([(210, 220), (280, 220)]),
        edge([(470, 220), (510, 220), (510, 122), (545, 122)]),
        edge([(755, 100), (870, 80)]),
        edge([(755, 120), (870, 190)]),
        edge([(650, 139), (650, 171)]),
        edge([(650, 229), (650, 261)]),
        edge([(755, 290), (870, 210)]),
        edge([(545, 305), (125, 305), (125, 411)]),
        edge([(650, 319), (650, 411)]),
        edge([(755, 430), (870, 410)]),
        edge([(755, 452), (870, 490)]),
    ]
    b += [
        label(662, 159, "send"),
        label(662, 249, "deliver (at least once)"),
        label(662, 372, "service binding"),
        label(137, 365, "full prompts and"),
        label(137, 380, "raw responses"),
        label(762, 402, "code + inputs only"),
        label(800, 494, "LLM calls", anchor="end"),
    ]
    return wrap(1100, 540, "Teacher app architecture on Cloudflare", "".join(b))


if __name__ == "__main__":
    (OUT / "pipeline.svg").write_text(pipeline())
    (OUT / "teacher-app.svg").write_text(teacher_app())
    print("wrote", OUT / "pipeline.svg", OUT / "teacher-app.svg")
