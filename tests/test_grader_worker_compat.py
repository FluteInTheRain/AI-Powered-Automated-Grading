import importlib, sys

def test_grader_imports_without_openai(monkeypatch):
    monkeypatch.setitem(sys.modules, "openai", None)  # import openai -> ImportError
    for m in ["grader.llm_client", "grader.pipeline", "grader.rubric_checks", "grader.feedback"]:
        sys.modules.pop(m, None)
    importlib.import_module("grader.pipeline"); importlib.import_module("grader.feedback")

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
