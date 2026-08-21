# -*- coding: utf-8 -*-
"""ORM models for the product DB — problems authored by a teacher, exam
links shared with students, and the submissions students turn in.

Separate from the thesis pipeline's data shape (data/problems.py,
data/dataset.json) — this is live product data, not pilot/experiment data.
"""
from __future__ import annotations

import datetime
import uuid

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


class Base(DeclarativeBase):
    pass


def _uuid_pk() -> Mapped[uuid.UUID]:
    return mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)


class Problem(Base):
    """A teacher-authored problem: statement, rubric, and test cases whose
    `expected` values were computed by running a reference solution
    (server/teacher.py's preview-test-cases endpoint), not hand-typed."""

    __tablename__ = "problems"

    id: Mapped[uuid.UUID] = _uuid_pk()
    statement: Mapped[str] = mapped_column(Text)
    func_name: Mapped[str] = mapped_column(String)
    param_names: Mapped[list] = mapped_column(JSONB)  # list[str]
    rubric: Mapped[dict] = mapped_column(JSONB)  # {correctness, efficiency, code_style, edge_case_handling}
    reference_solution: Mapped[str] = mapped_column(Text)
    # list[{"args": [...], "expected": <json>, "is_public": bool}]
    test_cases: Mapped[list] = mapped_column(JSONB)
    starter_code: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.datetime.now(datetime.timezone.utc)
    )

    exams: Mapped[list["Exam"]] = relationship(back_populates="problem")


class Exam(Base):
    """One shareable link pairing a problem with a deadline. `student_token`
    is handed to students (take the exam); `admin_token` is a separate
    secret kept by the teacher (view results, export, adjust deadline) —
    no login for either side."""

    __tablename__ = "exams"

    id: Mapped[uuid.UUID] = _uuid_pk()
    problem_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("problems.id"))
    student_token: Mapped[str] = mapped_column(String, unique=True, index=True)
    admin_token: Mapped[str] = mapped_column(String, unique=True, index=True)
    deadline: Mapped[datetime.datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    time_limit_seconds: Mapped[int] = mapped_column(Integer)
    created_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.datetime.now(datetime.timezone.utc)
    )

    problem: Mapped["Problem"] = relationship(back_populates="exams")
    submissions: Mapped[list["Submission"]] = relationship(back_populates="exam")


class Submission(Base):
    """One student's graded attempt at an exam. `result` stores the full,
    unmodified output of src/grader/pipeline.py's grade()."""

    __tablename__ = "submissions"

    id: Mapped[uuid.UUID] = _uuid_pk()
    exam_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("exams.id"))
    student_name: Mapped[str] = mapped_column(String)
    code: Mapped[str] = mapped_column(Text)
    result: Mapped[dict] = mapped_column(JSONB)
    submitted_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.datetime.now(datetime.timezone.utc)
    )

    exam: Mapped["Exam"] = relationship(back_populates="submissions")
