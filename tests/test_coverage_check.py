import ast

from grader import coverage_check as cc

REF = '''
def first_pos(xs):
    if not xs:
        return -1
    for i in range(len(xs)):
        if xs[i] > 0 and i >= 0:
            return i
    return -1
'''


def kinds(code):
    return {k for k, _, _ in cc.generate_mutants(code)}


def test_mutants_cover_all_fixed_kinds():
    assert kinds(REF) >= {"comparison", "and_or", "range_bound", "off_by_one", "drop_guard"}
    assert "wrong_end_element" in kinds("def f(a):\n    return a[0] + a[-1]\n")
    assert "wrong_return" in kinds("def f(a):\n    return True\n")
    assert "arithmetic" in kinds("def f(a):\n    return a + 1\n")


def test_mutants_are_deterministic_distinct_and_compile():
    a, b = cc.generate_mutants(REF), cc.generate_mutants(REF)
    assert a == b
    srcs = [s for _, _, s in a]
    assert len(srcs) == len(set(srcs))
    assert ast.unparse(ast.parse(REF)) not in srcs
    for s in srcs:
        compile(s, "m", "exec")


def test_specific_mutations():
    m = cc.generate_mutants("def f(a, b):\n    return a < b\n")
    assert any("def f(a, b):\n    return a <= b" in s for _, _, s in m)
    m = cc.generate_mutants("def f(a, b):\n    return a and b\n")
    assert any("a or b" in s for _, _, s in m)
    m = cc.generate_mutants("def f(n):\n    if n == 0:\n        return 1\n    return n\n")
    assert any(k == "drop_guard" for k, _, _ in m)


def test_range_bound_mutation_changes_stop():
    m = [s for k, _, s in cc.generate_mutants("def f(n):\n    for i in range(n):\n        pass\n")
         if k == "range_bound"]
    assert any("range(n + 1)" in s for s in m) and any("range(n - 1)" in s for s in m)


def test_kill_logic():
    assert cc.is_killed(None)
    assert cc.is_killed([True, False])
    assert not cc.is_killed([True, True])
    assert cc.mutation_score(3, 4) == 0.75
    assert cc.mutation_score(0, 0) is None


def test_run_against_tests_real_sandbox_and_timeout():
    code = "def f(x):\n    return x + 1\n"
    assert cc.run_against_tests(code, "f", [((1,), 2), ((1,), 3)]) == [True, False]
    assert cc.run_against_tests("def f(x):\n    while True:\n        pass\n", "f", [((1,), 1)], timeout=1) is None
    assert cc.run_against_tests("def g(x):\n    return x\n", "f", [((1,), 1)]) is None


PROBLEM = {
    "id": "T_inc", "func_name": "f",
    "submissions": [{"code": "def f(x):\n    if x < 0:\n        return 0\n    return x + 1\n"}],
}


def test_weak_suite_has_survivors_strong_suite_kills_more():
    weak = dict(PROBLEM, test_cases=[((5,), 6)])
    strong = dict(PROBLEM, test_cases=[((5,), 6), ((-1,), 0), ((0,), 1), ((-2,), 0)])
    rw, rs = cc.check_problem(weak), cc.check_problem(strong)
    assert rw["survivors"] and rw["weak"]
    assert rs["score"] > rw["score"]
    assert rs["killed"] + len(rs["survivors"]) == rs["total"]
    assert "survives" in cc.format_report(rw)


def test_bad_reference_reported_not_scored():
    bad = dict(PROBLEM, test_cases=[((5,), 99)])
    r = cc.check_problem(bad)
    assert r["error"] and r["score"] is None


def test_check_problem_with_stub_runner_marks_survivor():
    calls = []

    def runner(code, func, cases, timeout):
        calls.append(code)
        return [True] * len(cases)  # everything passes -> nothing killed

    r = cc.check_problem(dict(PROBLEM, test_cases=[((5,), 6)]), runner=runner)
    assert r["killed"] == 0 and len(r["survivors"]) == r["total"] > 0


def test_select_mutants_is_deterministic_spread_and_bounded():
    ms = [("k", f"d{i}", f"s{i}") for i in range(100)]
    a = cc.select_mutants(ms, 10)
    assert a == cc.select_mutants(ms, 10) and len(a) == 10
    assert a[0] == ms[0] and a[-1][1] == "d90"  # spread over the whole list, not the first ten
    assert cc.select_mutants(ms, None) == ms and cc.select_mutants(ms[:5], 10) == ms[:5]


def _pass_all(code, func, cases, timeout):
    return [True] * len(cases)


def test_check_code_cap_sets_capped_and_scores_the_sample():
    ref = "def f(a, b):\n    return a + b - 1 + 2 * a\n"
    full = cc.check_code(ref, "f", [((1, 2), 4)], runner=_pass_all)
    assert full["capped"] is False and full["total"] == full["generated"] > 3
    r = cc.check_code(ref, "f", [((1, 2), 4)], runner=_pass_all, max_mutants=3)
    assert r["capped"] is True and r["total"] == 3 and r["generated"] == full["generated"]
    assert r["killed"] == 0 and r["score"] == 0.0 and r["weak"] is True


def test_check_code_wall_budget_stops_new_mutants_but_runs_at_least_one():
    ref = "def f(a, b):\n    return a + b - 1 + 2 * a\n"
    ticks = iter(range(0, 1000, 10))  # every clock() call advances 10 "seconds"
    r = cc.check_code(ref, "f", [((1, 2), 4)], runner=_pass_all, budget_seconds=15, clock=lambda: next(ticks))
    assert 1 <= r["total"] < r["generated"] and r["capped"] is True


def test_check_code_bad_reference_and_no_mutants():
    assert cc.check_code("def f(x):\n    return x\n", "f", [((1,), 2)], runner=_pass_all_but_ref)["error"]
    r = cc.check_code("def f():\n    pass\n", "f", [((), None)], runner=_pass_all)
    assert r["total"] == 0 and r["score"] is None and r["weak"] is False and r["capped"] is False


def _pass_all_but_ref(code, func, cases, timeout):
    return [False] * len(cases)


def test_description_formats_match_app_worker_parser():
    """app-worker/src/check_tests.ts parses these descriptions into Vietnamese;
    change a format here and that file (and its test) must change too."""
    src = ("def f(xs, n):\n    if n < 0:\n        return False\n    for i in range(n):\n"
           "        n = n + 3 if xs[0] and xs[-1] else n\n    return True\n")
    by_kind = {}
    for k, d, _ in cc.generate_mutants(src):
        by_kind.setdefault(k, d)
    assert by_kind["comparison"] == "line 2: changed `<` to `<=` in `n <= 0`"
    assert by_kind["and_or"] == "line 5: swapped `and` for `or`"
    assert by_kind["arithmetic"] == "line 5: replaced `+` with `-`"
    assert by_kind["range_bound"].startswith("line 4: range upper bound off by one (+1) in `range(n)`")
    assert by_kind["wrong_end_element"] == "line 5: first-element access `[0]` returns `[1]` instead"
    assert by_kind["wrong_return"] == "line 3: `return False` flipped to `return True`"
    assert by_kind["drop_guard"] == "line 2: removed the guard `if n < 0: ...` (early return/raise)"
    assert by_kind["off_by_one"] == "line 2: integer literal 0 changed to 1"
