-- Phase 2: background grading jobs and one attempt per student name in an exam.
ALTER TABLE attempts ADD COLUMN name_key TEXT;
UPDATE attempts SET name_key = lower(trim(student_name));
-- A live database may already hold the same name twice in one exam: the first holder keeps the plain key,
-- later ones get a suffix so the unique index below can be created.
UPDATE attempts SET name_key = name_key || '#' || rowid
  WHERE rowid NOT IN (SELECT min(rowid) FROM attempts GROUP BY exam_id, name_key);
CREATE UNIQUE INDEX idx_attempts_exam_name ON attempts(exam_id, name_key);

-- Mutable on purpose (unlike submissions and score_revisions): it tracks the state of the grading work.
CREATE TABLE grading_jobs (
    submission_id TEXT PRIMARY KEY REFERENCES submissions(id),
    status TEXT NOT NULL CHECK (status IN ('queued', 'grading', 'done', 'failed')),
    attempts INTEGER NOT NULL DEFAULT 0,
    error TEXT,
    audit_key TEXT,                        -- R2 key of the LLM call log
    updated_at TEXT NOT NULL
);
