-- Appeals: a student disputes the score of one graded question; the teacher decides.
-- Mutable on purpose (like grading_jobs): the row tracks the state of the dispute. Scores stay append-only in
-- score_revisions; an adjusted appeal adds a revision, it never edits one.
CREATE TABLE appeals (
    id TEXT PRIMARY KEY,
    submission_id TEXT NOT NULL UNIQUE REFERENCES submissions(id),   -- one appeal per (attempt, question), never refiled
    message TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('open', 'under_review', 'upheld', 'adjusted', 'rejected', 'expired')),
    decision_note TEXT,
    decided_by TEXT,
    created_at TEXT NOT NULL,
    decided_at TEXT
);
CREATE INDEX idx_appeals_status_created ON appeals(status, created_at);
