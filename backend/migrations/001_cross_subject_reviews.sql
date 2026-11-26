-- Apply once to an existing PostgreSQL database before using cross-subject
-- review quizzes. Fresh databases use the nullable column from the model.
BEGIN;
ALTER TABLE quizzes ALTER COLUMN subject_id DROP NOT NULL;
COMMIT;
