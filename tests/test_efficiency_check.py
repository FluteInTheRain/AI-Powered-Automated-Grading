import pytest
from pydantic import ValidationError

from grader.rubric_checks import check_efficiency
from grader.schemas import EfficiencyCheck


class Fake:
    def __init__(self, payload):
        self.payload = payload

    def structured_call(self, system_prompt, user_prompt, schema):
        self.prompt = user_prompt
        return schema.model_validate(self.payload)


def run(payload):
    return check_efficiency(Fake(payload), "ST", "code")


def test_schema_states_the_expectation_and_the_pattern_before_the_verdict():
    keys = list(EfficiencyCheck.model_json_schema()["properties"])
    assert keys == ["expected_complexity", "observed_pattern", "meets_expected_complexity"]


def test_expected_complexity_is_required():
    with pytest.raises(ValidationError):
        EfficiencyCheck.model_validate({"meets_expected_complexity": True, "observed_pattern": "O(1)"})


def test_meeting_the_expectation_scores_full():
    score, _ = run({"expected_complexity": "O(n)", "observed_pattern": "O(n^2)", "meets_expected_complexity": True})
    assert score == 1.0


def test_missing_the_expectation_scores_0_4():
    score, _ = run({"expected_complexity": "O(log n)", "observed_pattern": "O(n)", "meets_expected_complexity": False})
    assert score == 0.4


@pytest.mark.parametrize("observed", ["O(log n)", "o(log n)", " O(log  n) ", "O(log N)"])
def test_a_verdict_that_contradicts_its_own_pattern_is_corrected(observed):
    # The live failure: pattern O(log n), expectation O(log n), yet "does not meet".
    score, detail = run({"expected_complexity": "O(log n)", "observed_pattern": observed, "meets_expected_complexity": False})
    assert score == 1.0
    assert detail.meets_expected_complexity is True
