-- Rollback: ALTER TABLE prerequisites DROP COLUMN group_index;

BEGIN;

ALTER TABLE prerequisites
  ADD COLUMN IF NOT EXISTS group_index INTEGER NOT NULL DEFAULT 0;

COMMENT ON COLUMN prerequisites.group_index IS
  'CNF group index. Rows with same (paper_code, group_index) are OR alternatives; '
  'rows with different group_index for the same paper_code are AND requirements.';

COMMIT;
