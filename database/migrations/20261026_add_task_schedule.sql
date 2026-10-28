ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS starts_at TIMESTAMPTZ;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'tasks_schedule_order_check'
      AND conrelid = 'tasks'::regclass
  ) THEN
    ALTER TABLE tasks
      ADD CONSTRAINT tasks_schedule_order_check
      CHECK (starts_at IS NULL OR due_at IS NULL OR due_at >= starts_at);
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS tasks_project_start_due_idx
  ON tasks (project_id, starts_at, due_at)
  WHERE status IN ('open', 'in_progress');
