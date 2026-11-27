-- Daily determinism canary: one fixed input graded once a day; each run is compared with the first run that used the
-- same (model, input_version). Append-only in practice, mutable in schema because nothing edits it.
CREATE TABLE canary_runs (
    id TEXT PRIMARY KEY,
    ran_at TEXT NOT NULL,
    score REAL,
    sub_scores TEXT,
    fingerprint TEXT,                      -- SHA-256 of the raw LLM responses
    model TEXT,
    input_version INTEGER NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('ok', 'error')),
    error TEXT
);
CREATE INDEX idx_canary_ran_at ON canary_runs(ran_at);
