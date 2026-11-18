import importlib, sys

MODS = ["grader.llm_client", "grader.pipeline", "grader.rubric_checks", "grader.feedback"]


def test_grader_imports_without_openai(monkeypatch):
    before = {m: sys.modules.get(m) for m in MODS}
    monkeypatch.setitem(sys.modules, "openai", None)  # import openai -> ImportError
    for m in MODS:
        # setitem records the original entry (or its absence) for undo; delitem then
        # removes it so the import below runs fresh. Undo restores both exactly.
        monkeypatch.setitem(sys.modules, m, None)
        monkeypatch.delitem(sys.modules, m)
    importlib.import_module("grader.pipeline"); importlib.import_module("grader.feedback")
    monkeypatch.undo()
    # Other test modules keep using the module objects they imported.
    assert all(sys.modules.get(m) is before[m] for m in MODS)

def test_grade_uses_injected_runner():
    from grader.pipeline import grade
    calls = []
    def fake_run(code, func_name, cases):
        calls.append(func_name)
        return {"pass_count": 0, "total": 1, "pass_rate": 0.0, "errors": ["x"], "status": "ran"}
    out = grade({"submission_code": "x", "func_name": "f", "test_cases": [((1,), 1)],
                 "rubric": {"correctness": 60, "efficiency": 15, "code_style": 15, "edge_case_handling": 10},
                 "statement": "s"}, client=None, run_submission=fake_run)
    assert calls == ["f"] and out["final_score_0_to_100"] == 0.0
