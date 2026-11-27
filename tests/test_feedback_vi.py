from src.grader.feedback import _fill_missing_issues
from src.grader.schemas import CodeFeedback, FeedbackItem


def _fb(issue):
    return CodeFeedback(summary="ok", issues=[FeedbackItem(
        line=2, issue=issue, explanation="x", suggested_fix="y")])


def test_vietnamese_issue_counts_as_already_raised():
    out = _fill_missing_issues(_fb("đặt tên biến chưa rõ"), {"code_style": 0.6}, {"code_style": {}})
    assert len(out.issues) == 1


def test_missing_check_gets_vietnamese_placeholder():
    out = _fill_missing_issues(_fb("sai điều kiện dừng"), {"efficiency": 0.0}, {"efficiency": {}})
    assert len(out.issues) == 2
    assert "hiệu năng" in out.issues[1].issue


def _placeholder(check, detail, score=0.4):
    out = _fill_missing_issues(_fb("sai điều kiện dừng"), {check: score}, {check: detail})
    return out.issues[1]


def test_placeholder_is_readable_and_has_no_raw_json():
    for check, detail in [
        ("efficiency", {"expected_complexity": "O(log n)", "observed_pattern": "O(n)", "meets_expected_complexity": False}),
        ("code_style", {"level": "medium"}),
        ("edge_case_handling", {"handled": False, "missing_cases": ["mảng rỗng"]}),
    ]:
        item = _placeholder(check, detail)
        assert "{" not in item.explanation and "meets_expected" not in item.explanation and "handled" not in item.explanation


def test_efficiency_placeholder_names_what_was_expected_and_observed():
    item = _placeholder("efficiency", {"expected_complexity": "O(log n)", "observed_pattern": "O(n)", "meets_expected_complexity": False})
    assert "O(n)" in item.explanation and "O(log n)" in item.explanation


def test_efficiency_placeholder_still_works_for_results_stored_before_expected_complexity_existed():
    item = _placeholder("efficiency", {"observed_pattern": "O(n^2)", "meets_expected_complexity": False})
    assert "O(n^2)" in item.explanation


def test_style_placeholder_names_the_level():
    assert "Trung bình" in _placeholder("code_style", {"level": "medium"}, 0.6).explanation


def test_edge_placeholder_lists_the_missing_cases():
    item = _placeholder("edge_case_handling", {"handled": False, "missing_cases": ["mảng rỗng", "phần tử cuối"]}, 0.25)
    assert "mảng rỗng" in item.explanation and "phần tử cuối" in item.explanation
