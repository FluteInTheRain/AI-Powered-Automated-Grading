# -*- coding: utf-8 -*-
"""Demo UI for the grading pipeline — pick a problem, paste/edit a
submission, grade it live against the running llama-server, see the
sandbox result and every rubric check's output.

This is a demo shell around the real pipeline (src/grader/pipeline.py),
not a reimplementation — every rule in CLAUDE.md still applies to the
underlying grading. Run: streamlit run app.py
"""
from __future__ import annotations

import sys
from pathlib import Path

import streamlit as st

sys.path.insert(0, str(Path(__file__).resolve().parent / "src"))
sys.path.insert(0, str(Path(__file__).resolve().parent / "data"))

from grader.feedback import generate_feedback
from grader.llm_client import LLMClient
from grader.pipeline import grade
from problems import PROBLEMS

st.set_page_config(page_title="Automated Grading — Demo", layout="wide")
st.title("AI-Powered Automated Grading — Demo")
st.caption(
    "Correctness is scored by real sandboxed test execution. Every other "
    "rubric dimension is scored by an independent, structured-output LLM "
    "call. The final score is a fixed weighted sum computed in Python — "
    "never by the LLM."
)

with st.sidebar:
    st.header("Server")
    base_url = st.text_input("base_url", value="http://localhost:8080/v1")
    model = st.text_input("model", value="Qwen/Qwen2.5-Coder-1.5B-Instruct-GGUF:Q8_0")
    try:
        import urllib.request
        with urllib.request.urlopen(base_url.replace("/v1", "/health"), timeout=2) as resp:
            st.success("Server reachable") if resp.status == 200 else st.error("Server unreachable")
    except Exception:
        st.error("Server unreachable — start it with scripts/model_server.sh start")

problem_ids = [p["id"] for p in PROBLEMS]
selected_id = st.selectbox("Problem", problem_ids)
problem = next(p for p in PROBLEMS if p["id"] == selected_id)

st.subheader("Problem statement")
st.write(problem["statement"])

st.subheader("Rubric (weights out of 100)")
st.json(problem["rubric"])

submission_ids = [s["sub_id"] for s in problem["submissions"]]
selected_sub_id = st.selectbox(
    "Start from an existing submission (or edit freely below)", submission_ids
)
default_code = next(s["code"] for s in problem["submissions"] if s["sub_id"] == selected_sub_id)

code = st.text_area("Submission code", value=default_code.strip(), height=300)

if st.button("Grade", type="primary"):
    sample = {
        "statement": problem["statement"],
        "func_name": problem["func_name"],
        "test_cases": problem["test_cases"],
        "rubric": problem["rubric"],
        "submission_code": code,
    }
    client = LLMClient(base_url=base_url, model=model, seed=0)
    with st.spinner("Running sandbox + LLM rubric checks..."):
        try:
            result = grade(sample, client)
        except Exception as e:
            st.error(f"Grading failed: {e}")
            st.stop()

    st.subheader("Result")
    st.metric("Final score", f"{result['final_score_0_to_100']:.1f} / 100")

    cols = st.columns(4)
    for col, (check, score) in zip(cols, result["sub_scores_0_to_1"].items()):
        col.metric(check, f"{score:.2f}")

    st.subheader("Sandbox execution detail")
    exec_result = result["execution_result"]
    st.write(f"Passed {exec_result['pass_count']}/{exec_result['total']} test cases.")
    if exec_result["errors"]:
        st.table([{"failure": e} for e in exec_result["errors"]])

    st.subheader("Teacher feedback")
    with st.spinner("Generating line-by-line feedback..."):
        try:
            feedback = generate_feedback(
                client, problem["statement"], code, exec_result, result["sub_scores_0_to_1"]
            )
        except Exception as e:
            st.error(f"Feedback generation failed: {e}")
            feedback = None

    if feedback:
        st.write(feedback.summary)
        if feedback.issues:
            code_lines = code.split("\n")
            for item in feedback.issues:
                with st.expander(f"Line {item.line}: {item.issue}"):
                    if 1 <= item.line <= len(code_lines):
                        st.code(code_lines[item.line - 1], language="python")
                    st.markdown(f"**Why it's wrong:** {item.explanation}")
                    st.markdown(f"**Suggested fix:** {item.suggested_fix}")
