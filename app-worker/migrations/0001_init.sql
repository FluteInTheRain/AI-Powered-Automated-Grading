-- teacher-app schema. ids are uuid4 hex TEXT, timestamps ISO-8601 UTC TEXT, JSON columns TEXT.
CREATE TABLE teachers (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,            -- stored lower-case
    created_at TEXT NOT NULL
);

CREATE TABLE problems (
    id TEXT PRIMARY KEY,
    owner_teacher_id TEXT REFERENCES teachers(id),   -- NULL for the system bank
    visibility TEXT NOT NULL CHECK (visibility IN ('system', 'private')),
    statement TEXT NOT NULL,
    func_name TEXT NOT NULL,
    param_names TEXT NOT NULL,             -- JSON list[str]
    rubric TEXT NOT NULL,                  -- JSON object
    reference_solution TEXT NOT NULL,
    test_cases TEXT NOT NULL,              -- JSON list of {args, expected, is_public}
    starter_code TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE TABLE exams (
    id TEXT PRIMARY KEY,
    teacher_id TEXT NOT NULL REFERENCES teachers(id),
    title TEXT NOT NULL,
    student_token TEXT NOT NULL UNIQUE,
    deadline TEXT,
    time_limit_seconds INTEGER NOT NULL,
    created_at TEXT NOT NULL
);
CREATE INDEX idx_exams_teacher ON exams(teacher_id);

CREATE TABLE exam_questions (
    exam_id TEXT NOT NULL REFERENCES exams(id),
    problem_id TEXT NOT NULL REFERENCES problems(id),
    position INTEGER NOT NULL,
    weight REAL NOT NULL,
    PRIMARY KEY (exam_id, problem_id)
);

CREATE TABLE attempts (
    id TEXT PRIMARY KEY,
    exam_id TEXT NOT NULL REFERENCES exams(id),
    student_name TEXT NOT NULL,
    receipt_code TEXT NOT NULL UNIQUE,
    started_at TEXT NOT NULL
);
CREATE INDEX idx_attempts_exam ON attempts(exam_id);

CREATE TABLE submissions (
    id TEXT PRIMARY KEY,
    attempt_id TEXT NOT NULL REFERENCES attempts(id),
    problem_id TEXT NOT NULL REFERENCES problems(id),
    code TEXT NOT NULL,
    submitted_at TEXT NOT NULL,
    UNIQUE (attempt_id, problem_id)
);

CREATE TABLE score_revisions (
    id TEXT PRIMARY KEY,
    submission_id TEXT NOT NULL REFERENCES submissions(id),
    revision INTEGER NOT NULL,             -- 0 = the AI score
    source TEXT NOT NULL CHECK (source IN ('ai', 'teacher')),
    score REAL NOT NULL,
    sub_scores TEXT NOT NULL,              -- JSON
    detail TEXT NOT NULL,                  -- JSON (whole grading result)
    author TEXT NOT NULL,
    reason TEXT,
    created_at TEXT NOT NULL,
    UNIQUE (submission_id, revision)
);

CREATE TABLE grading_logs (
    id TEXT PRIMARY KEY,
    submission_id TEXT NOT NULL REFERENCES submissions(id),
    call_index INTEGER NOT NULL,
    kind TEXT NOT NULL,
    schema_name TEXT,
    model TEXT NOT NULL,
    system_prompt TEXT NOT NULL,
    user_prompt TEXT NOT NULL,
    raw_response TEXT NOT NULL,
    created_at TEXT NOT NULL
);
CREATE INDEX idx_grading_logs_submission ON grading_logs(submission_id);

-- Append-only: scores and submissions are never edited or removed.
CREATE TRIGGER score_revisions_no_update BEFORE UPDATE ON score_revisions
BEGIN SELECT RAISE(ABORT, 'score_revisions is append-only'); END;
CREATE TRIGGER score_revisions_no_delete BEFORE DELETE ON score_revisions
BEGIN SELECT RAISE(ABORT, 'score_revisions is append-only'); END;
CREATE TRIGGER submissions_no_update BEFORE UPDATE ON submissions
BEGIN SELECT RAISE(ABORT, 'submissions is append-only'); END;
CREATE TRIGGER submissions_no_delete BEFORE DELETE ON submissions
BEGIN SELECT RAISE(ABORT, 'submissions is append-only'); END;
