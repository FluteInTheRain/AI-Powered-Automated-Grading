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
