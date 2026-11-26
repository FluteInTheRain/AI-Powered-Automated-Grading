-- Per-exam rubric weights and per-teacher settings.
-- exams.rubric is a JSON snapshot taken at creation; NULL means "use each problem's own rubric" (all exams made before this).
ALTER TABLE exams ADD COLUMN rubric TEXT;
-- JSON: { default_rubric?, default_time_limit_seconds? }
ALTER TABLE teachers ADD COLUMN settings TEXT NOT NULL DEFAULT '{}';
