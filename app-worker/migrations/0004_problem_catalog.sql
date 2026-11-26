-- Catalog fields for the question picker. Nullable: SQLite cannot add a NOT NULL column without a default,
-- and problems created before this migration are backfilled below.
ALTER TABLE problems ADD COLUMN title TEXT;
ALTER TABLE problems ADD COLUMN category TEXT;
ALTER TABLE problems ADD COLUMN difficulty TEXT CHECK (difficulty IN ('easy', 'medium', 'hard'));
UPDATE problems
   SET title = substr(trim(replace(statement, char(10), ' ')), 1, 60), category = 'Other', difficulty = 'medium'
 WHERE title IS NULL;
