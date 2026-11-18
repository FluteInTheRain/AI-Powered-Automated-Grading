-- D1 (SQLite) schema mirroring server/models.py. ids are uuid4().hex TEXT,
-- JSON columns are TEXT, timestamps are ISO-8601 UTC TEXT.
CREATE TABLE problems (
    id TEXT PRIMARY KEY,
    statement TEXT NOT NULL,
    func_name TEXT NOT NULL,
    param_names TEXT NOT NULL,        -- JSON list[str]
    rubric TEXT NOT NULL,             -- JSON object
    reference_solution TEXT NOT NULL,
    test_cases TEXT NOT NULL,         -- JSON list
    starter_code TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE TABLE exams (
    id TEXT PRIMARY KEY,
    problem_id TEXT NOT NULL REFERENCES problems(id),
    student_token TEXT NOT NULL UNIQUE,
    admin_token TEXT NOT NULL UNIQUE,
    deadline TEXT,                    -- nullable ISO-8601 UTC
    time_limit_seconds INTEGER NOT NULL,
    created_at TEXT NOT NULL
);

CREATE TABLE submissions (
    id TEXT PRIMARY KEY,
    exam_id TEXT NOT NULL REFERENCES exams(id),
    student_name TEXT NOT NULL,
    code TEXT NOT NULL,
    result TEXT NOT NULL,             -- JSON object
    submitted_at TEXT NOT NULL
);
CREATE INDEX idx_submissions_exam ON submissions(exam_id);

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
