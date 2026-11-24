-- Add a read-only feedback tool to existing assistant evidence storage.
-- Does not add tables, widen role grants or rewrite stored runs.
BEGIN;
ALTER TABLE movie.assistant_run_steps
  DROP CONSTRAINT assistant_run_steps_tool_check;
ALTER TABLE movie.assistant_run_steps
  ADD CONSTRAINT assistant_run_steps_tool_check CHECK (
    tool IN ('search_catalog','get_title_details','get_published_episodes','search_help','get_title_feedback')
  );
COMMIT;
