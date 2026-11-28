# -*- coding: utf-8 -*-
"""Test-suite coverage checker (PR-B3): a small mutation-testing pass.

Given a reference solution and its test cases, apply a fixed set of
deterministic AST mutations to the reference, run every mutant against the
tests, and report which mutants still pass all tests ("surviving"). A
surviving mutant means the suite has a gap. No LLM is involved; the same
input always yields the same mutants in the same order.

Mutant execution goes through grader.sandbox.run_submission_cases, in a
child process per mutant so an infinite loop in a mutant (for example a
broken loop bound) is killed by a timeout instead of hanging the checker.
A timeout counts as a kill: any real grading run would also fail on it.

Caveat: some surviving mutants are equivalent (the change does not alter
behaviour on any input, e.g. `i * i <= n` vs `i * i < n` when n is never a
perfect square at the boundary). The report lists survivors for a human to
judge; the mutation score is therefore a lower bound on suite strength.
"""
from __future__ import annotations

import ast
import copy
import json
import pickle
import subprocess
import sys
from pathlib import Path
from typing import Any, Callable, Iterator, List, Optional, Tuple

_SRC = str(Path(__file__).resolve().parent.parent)

DEFAULT_TIMEOUT = 5.0
WEAK_THRESHOLD = 0.8

_CMP_SWAP = {
    ast.Lt: ast.LtE, ast.LtE: ast.Lt, ast.Gt: ast.GtE, ast.GtE: ast.Gt,
    ast.Eq: ast.NotEq, ast.NotEq: ast.Eq, ast.In: ast.NotIn, ast.NotIn: ast.In,
}
_OP_TEXT = {
    ast.Lt: "<", ast.LtE: "<=", ast.Gt: ">", ast.GtE: ">=", ast.Eq: "==", ast.NotEq: "!=",
    ast.In: "in", ast.NotIn: "not in",
    ast.Add: "+", ast.Sub: "-", ast.Mult: "*", ast.FloorDiv: "//", ast.Mod: "%",
}
_ARITH_SWAP = {ast.Add: ast.Sub, ast.Sub: ast.Add, ast.Mult: ast.Add, ast.FloorDiv: ast.Mult}

Mutant = Tuple[str, str, str]  # (kind, plain-words description, mutated source)


def _where(node: ast.AST) -> str:
    return f"line {getattr(node, 'lineno', '?')}"


def _nth(tree: ast.AST, pred: Callable[[ast.AST], bool], n: int) -> ast.AST:
    """n-th node (in ast.walk order) matching pred; walk order is stable
    across deepcopy, so site indexes found on the original apply to copies."""
    i = 0
    for node in ast.walk(tree):
        if pred(node):
            if i == n:
                return node
            i += 1
    raise IndexError(n)


def _sites(tree: ast.AST, pred: Callable[[ast.AST], bool]) -> int:
    return sum(1 for node in ast.walk(tree) if pred(node))


def _is_int_const(n: ast.AST) -> bool:
    return isinstance(n, ast.Constant) and type(n.value) is int


def _is_range_call(n: ast.AST) -> bool:
    return (isinstance(n, ast.Call) and isinstance(n.func, ast.Name)
            and n.func.id == "range" and 1 <= len(n.args) <= 3)


def _is_cmp_op_site(n: ast.AST) -> bool:
    return isinstance(n, ast.Compare)


def _is_boolop(n: ast.AST) -> bool:
    return isinstance(n, ast.BoolOp)


def _is_binop(n: ast.AST) -> bool:
    return isinstance(n, ast.BinOp) and type(n.op) in _ARITH_SWAP


def _end_index(n: ast.AST) -> Optional[int]:
    """0 or -1 when `n` is a subscript by the literal 0 or -1, else None."""
    if not isinstance(n, ast.Subscript):
        return None
    try:
        v = ast.literal_eval(n.slice)
    except (ValueError, SyntaxError):
        return None
    return v if type(v) is int and v in (0, -1) else None


def _is_index_end(n: ast.AST) -> bool:
    return _end_index(n) is not None


def _is_bool_return(n: ast.AST) -> bool:
    return (isinstance(n, ast.Return) and isinstance(n.value, ast.Constant)
            and isinstance(n.value.value, bool))


def _is_guard(n: ast.AST) -> bool:
    """An `if` with no else whose body only returns/raises: an input guard."""
    return (isinstance(n, ast.If) and not n.orelse
            and all(isinstance(s, (ast.Return, ast.Raise)) for s in n.body))


def _gen(tree: ast.AST, pred, apply: Callable[[ast.AST], Optional[str]], kind: str) -> Iterator[Mutant]:
    """For each site matching pred, deepcopy the tree, let `apply` mutate the
    node in place (it may return several variants by being called with
    variant index through closures; here one variant per call) and yield."""
    for idx in range(_sites(tree, pred)):
        copy_tree = copy.deepcopy(tree)
        node = _nth(copy_tree, pred, idx)
        desc = apply(node)
        if desc is None:
            continue
        ast.fix_missing_locations(copy_tree)
        yield kind, desc, ast.unparse(copy_tree)


def _gen_variants(tree, pred, variants: Callable[[ast.AST], List[Callable[[ast.AST], str]]], kind) -> Iterator[Mutant]:
    for idx in range(_sites(tree, pred)):
        n_var = len(variants(_nth(tree, pred, idx)))
        for v in range(n_var):
            copy_tree = copy.deepcopy(tree)
            node = _nth(copy_tree, pred, idx)
            desc = variants(node)[v](node)
            ast.fix_missing_locations(copy_tree)
            yield kind, desc, ast.unparse(copy_tree)


def _mut_compare(tree) -> Iterator[Mutant]:
    def variants(node):
        out = []
        for i, op in enumerate(node.ops):
            if type(op) in _CMP_SWAP:
                def f(n, i=i, op=op):
                    new = _CMP_SWAP[type(op)]()
                    n.ops[i] = new
                    return (f"{_where(n)}: changed `{_OP_TEXT[type(op)]}` to "
                            f"`{_OP_TEXT[type(new)]}` in `{ast.unparse(n)}`")
                out.append(f)
        return out
    return _gen_variants(tree, _is_cmp_op_site, variants, "comparison")


def _mut_boolop(tree) -> Iterator[Mutant]:
    def variants(node):
        def f(n):
            old, new = ("and", ast.Or()) if isinstance(n.op, ast.And) else ("or", ast.And())
            n.op = new
            return f"{_where(n)}: swapped `{old}` for `{'or' if old == 'and' else 'and'}`"
        return [f]
    return _gen_variants(tree, _is_boolop, variants, "and_or")


def _mut_arith(tree) -> Iterator[Mutant]:
    def variants(node):
        def f(n):
            old = type(n.op)
            n.op = _ARITH_SWAP[old]()
            return (f"{_where(n)}: replaced `{_OP_TEXT[old]}` with "
                    f"`{_OP_TEXT[type(n.op)]}`")
        return [f]
    return _gen_variants(tree, _is_binop, variants, "arithmetic")


def _mut_range_bound(tree) -> Iterator[Mutant]:
    """Off-by-one on a range() upper bound (the last positional arg that is
    the stop value: args[0] for range(n), args[1] otherwise)."""
    def variants(node):
        out = []
        for delta in (1, -1):
            def f(n, delta=delta):
                stop_i = 0 if len(n.args) == 1 else 1
                before = ast.unparse(n)
                n.args[stop_i] = ast.BinOp(n.args[stop_i], ast.Add() if delta > 0 else ast.Sub(),
                                           ast.Constant(1))
                return (f"{_where(n)}: range upper bound off by one "
                        f"({'+1' if delta > 0 else '-1'}) in `{before}`")
            out.append(f)
        return out
    return _gen_variants(tree, _is_range_call, variants, "range_bound")


def _mut_int_const(tree) -> Iterator[Mutant]:
    def variants(node):
        out = []
        for delta in (1, -1):
            def f(n, delta=delta):
                old = n.value
                n.value = old + delta
                return f"{_where(n)}: integer literal {old} changed to {old + delta}"
            out.append(f)
        return out
    return _gen_variants(tree, _is_int_const, variants, "off_by_one")


def _mut_end_index(tree) -> Iterator[Mutant]:
    """First/last element access gives the wrong element."""
    def variants(node):
        def f(n):
            old = _end_index(n)
            new = 1 if old == 0 else -2
            n.slice = ast.Constant(new) if new >= 0 else ast.UnaryOp(ast.USub(), ast.Constant(-new))
            what = "first" if old == 0 else "last"
            return f"{_where(n)}: {what}-element access `[{old}]` returns `[{new}]` instead"
        return [f]
    return _gen_variants(tree, _is_index_end, variants, "wrong_end_element")


def _mut_bool_return(tree) -> Iterator[Mutant]:
    def variants(node):
        def f(n):
            old = n.value.value
            n.value = ast.Constant(not old)
            return f"{_where(n)}: `return {old}` flipped to `return {not old}`"
        return [f]
    return _gen_variants(tree, _is_bool_return, variants, "wrong_return")


def _mut_drop_guard(tree) -> Iterator[Mutant]:
    def variants(node):
        def f(n):
            text = ast.unparse(n.test)
            n.__class__ = ast.If
            n.test = ast.Constant(False)  # guard never fires
            return f"{_where(n)}: removed the guard `if {text}: ...` (early return/raise)"
        return [f]
    return _gen_variants(tree, _is_guard, variants, "drop_guard")


# Order matters for labelling: specific mutators run before the generic
# integer-literal one, and a mutant duplicated by a later mutator is dropped.
MUTATORS = (_mut_compare, _mut_boolop, _mut_arith, _mut_range_bound,
            _mut_end_index, _mut_bool_return, _mut_drop_guard, _mut_int_const)


def generate_mutants(reference_code: str) -> List[Mutant]:
    """Deterministic list of distinct, compilable mutants of `reference_code`.
    Mutants whose source is identical to the reference or to an earlier
    mutant are dropped."""
    import textwrap
    tree = ast.parse(textwrap.dedent(reference_code))
    base = ast.unparse(tree)
    seen = {base}
    out: List[Mutant] = []
    for mutator in MUTATORS:
        for kind, desc, src in mutator(tree):
            if src in seen:
                continue
            try:
                compile(src, "<mutant>", "exec")
            except SyntaxError:
                continue
            seen.add(src)
            out.append((kind, desc, src))
    return out


_RUNNER = r"""
import pickle, sys
sys.path.insert(0, sys.argv[1])
from grader.sandbox import run_submission_cases
code, func, cases = pickle.load(sys.stdin.buffer)
r = run_submission_cases(code, func, cases)
sys.stdout.write("RESULT:" + ("ERR" if r["status"] != "ran" else "".join("1" if c["passed"] else "0" for c in r["cases"])))
"""


def run_against_tests(code: str, func_name: str, test_cases: List[Tuple[tuple, Any]],
                      timeout: float = DEFAULT_TIMEOUT) -> Optional[List[bool]]:
    """Per-case pass flags via the sandbox, in a child process. Returns None
    on timeout, crash or compile/func-not-found failure."""
    try:
        proc = subprocess.run(
            [sys.executable, "-I", "-c", _RUNNER, _SRC],
            input=pickle.dumps((code, func_name, test_cases)),
            capture_output=True, timeout=timeout,
        )
    except subprocess.TimeoutExpired:
        return None
    out = proc.stdout.decode(errors="replace")
    if proc.returncode != 0 or "RESULT:" not in out:
        return None
    tail = out.split("RESULT:", 1)[1]
    if tail == "ERR":
        return None
    return [ch == "1" for ch in tail]


def is_killed(flags: Optional[List[bool]]) -> bool:
    """A mutant is killed unless it ran and passed every test case. A
    timeout/crash/compile failure (flags None) counts as killed."""
    if flags is None:
        return True
    return not all(flags)


def mutation_score(killed: int, total: int) -> Optional[float]:
    return round(killed / total, 4) if total else None


def check_problem(problem: dict, reference_code: Optional[str] = None,
                  runner: Callable[..., Optional[List[bool]]] = run_against_tests,
                  timeout: float = DEFAULT_TIMEOUT) -> dict:
    """Coverage report for one problem dict (id, func_name, test_cases,
    submissions). The reference is `reference_code`, or the first submission
    (the bank's correct clean solution) when not given."""
    ref = reference_code or problem["submissions"][0]["code"]
    func, cases = problem["func_name"], problem["test_cases"]
    base = runner(ref, func, cases, timeout)
    if base is None or not all(base):
        return {"id": problem["id"], "error": "reference solution does not pass its own tests",
                "total": 0, "killed": 0, "score": None, "weak": None, "survivors": []}
    mutants = generate_mutants(ref)
    survivors, killed = [], 0
    for kind, desc, src in mutants:
        if is_killed(runner(src, func, cases, timeout)):
            killed += 1
        else:
            survivors.append({"kind": kind, "description": desc, "code": src})
    score = mutation_score(killed, len(mutants))
    return {"id": problem["id"], "num_tests": len(cases), "total": len(mutants),
            "killed": killed, "score": score,
            "weak": score is not None and score < WEAK_THRESHOLD,
            "survivors": survivors}


def format_report(report: dict) -> str:
    if report.get("error"):
        return f"{report['id']}: ERROR {report['error']}"
    score = "n/a" if report["score"] is None else f"{report['score']:.2f}"
    lines = [f"{report['id']}: mutation score {score} "
             f"({report['killed']}/{report['total']} killed, {report['num_tests']} tests)"
             + ("  WEAK" if report["weak"] else "")]
    for s in report["survivors"]:
        lines.append(f"  - survives: {s['description']}")
    return "\n".join(lines)


def main(argv: Optional[List[str]] = None) -> int:
    import argparse
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--out", default="results/coverage_check.json")
    ap.add_argument("--only", help="problem id substring filter")
    args = ap.parse_args(argv)
    root = Path(__file__).resolve().parent.parent.parent
    sys.path.insert(0, str(root / "data"))
    from problems import PROBLEMS  # noqa: E402
    reports = []
    for p in PROBLEMS:
        if args.only and args.only not in p["id"]:
            continue
        r = check_problem(p)
        reports.append(r)
        print(format_report(r))
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps({"weak_threshold": WEAK_THRESHOLD, "problems": reports}, indent=2))
    weak = [r["id"] for r in reports if r["weak"]]
    print(f"\nWeak (< {WEAK_THRESHOLD}): {', '.join(weak) or 'none'}  -> {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
