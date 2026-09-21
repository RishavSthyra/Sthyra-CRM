CREATE TABLE IF NOT EXISTS user_availability (
  user_id UUID PRIMARY KEY,
  timezone VARCHAR(100) NOT NULL DEFAULT 'Asia/Kolkata',
  weekly_schedule JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_available BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT fk_user_availability_user
    FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE,
  CONSTRAINT user_availability_schedule_object_check
    CHECK (jsonb_typeof(weekly_schedule) = 'object')
);

CREATE TABLE IF NOT EXISTS user_leaves (
  leave_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  leave_type VARCHAR(50) NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  reason TEXT,
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  approved_by UUID,
  approved_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT fk_user_leaves_user
    FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE,
  CONSTRAINT fk_user_leaves_approved_by
    FOREIGN KEY (approved_by) REFERENCES users(user_id) ON DELETE SET NULL,
  CONSTRAINT user_leaves_date_check
    CHECK (end_date >= start_date),
  CONSTRAINT user_leaves_status_check
    CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled'))
);

CREATE INDEX IF NOT EXISTS user_leaves_user_id_idx
  ON user_leaves (user_id);

CREATE INDEX IF NOT EXISTS user_leaves_user_dates_idx
  ON user_leaves (user_id, start_date, end_date);

CREATE INDEX IF NOT EXISTS user_leaves_status_idx
  ON user_leaves (status);
