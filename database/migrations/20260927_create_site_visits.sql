BEGIN;

ALTER TABLE appointments DROP CONSTRAINT IF EXISTS appointments_status_check;
ALTER TABLE appointments ADD CONSTRAINT appointments_status_check
  CHECK (status IN ('scheduled', 'confirmed', 'rescheduled', 'checked_in',
                    'cancelled', 'completed', 'no_show'));

CREATE TABLE IF NOT EXISTS site_visits (
  visit_id UUID PRIMARY KEY REFERENCES appointments(appointment_id) ON DELETE CASCADE,
  arrival_instructions TEXT,
  transport_notes TEXT,
  attendee_count INTEGER,
  check_in_at TIMESTAMPTZ,
  checked_in_by UUID REFERENCES users(user_id) ON DELETE SET NULL,
  check_in_latitude NUMERIC(9,6),
  check_in_longitude NUMERIC(9,6),
  check_in_notes TEXT,
  outcome VARCHAR(30),
  feedback TEXT,
  customer_rating INTEGER,
  next_action TEXT,
  no_show_at TIMESTAMPTZ,
  no_show_by UUID REFERENCES users(user_id) ON DELETE SET NULL,
  no_show_reason TEXT,
  reschedule_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT site_visits_attendee_count_check
    CHECK (attendee_count IS NULL OR attendee_count >= 0),
  CONSTRAINT site_visits_location_check CHECK (
    (check_in_latitude IS NULL AND check_in_longitude IS NULL)
    OR (check_in_latitude BETWEEN -90 AND 90 AND check_in_longitude BETWEEN -180 AND 180)
  ),
  CONSTRAINT site_visits_outcome_check CHECK (
    outcome IS NULL OR outcome IN ('interested', 'follow_up', 'not_interested',
      'booking_requested', 'needs_time', 'unreachable')
  ),
  CONSTRAINT site_visits_rating_check
    CHECK (customer_rating IS NULL OR customer_rating BETWEEN 1 AND 5)
);

INSERT INTO site_visits (visit_id)
SELECT appointment_id FROM appointments WHERE appointment_type='site_visit'
ON CONFLICT (visit_id) DO NOTHING;

CREATE TABLE IF NOT EXISTS site_visit_state_history (
  history_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  visit_id UUID NOT NULL REFERENCES site_visits(visit_id) ON DELETE CASCADE,
  action VARCHAR(50) NOT NULL,
  from_status VARCHAR(20),
  to_status VARCHAR(20) NOT NULL,
  previous_starts_at TIMESTAMPTZ,
  previous_ends_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  performed_by UUID REFERENCES users(user_id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT site_visit_state_history_metadata_check
    CHECK (jsonb_typeof(metadata)='object')
);
CREATE INDEX IF NOT EXISTS site_visit_state_history_visit_idx
  ON site_visit_state_history (visit_id, created_at DESC, history_id DESC);

CREATE TABLE IF NOT EXISTS site_visit_participants (
  participant_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  visit_id UUID NOT NULL REFERENCES site_visits(visit_id) ON DELETE CASCADE,
  participant_type VARCHAR(20) NOT NULL,
  user_id UUID REFERENCES users(user_id) ON DELETE CASCADE,
  contact_id UUID REFERENCES contacts(contact_id) ON DELETE CASCADE,
  external_name VARCHAR(200),
  external_email VARCHAR(255),
  external_phone VARCHAR(30),
  participant_role VARCHAR(50) NOT NULL DEFAULT 'attendee',
  attendance_status VARCHAR(20) NOT NULL DEFAULT 'expected',
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT site_visit_participants_type_check
    CHECK (participant_type IN ('user', 'contact', 'external')),
  CONSTRAINT site_visit_participants_role_check
    CHECK (participant_role IN ('organizer', 'host', 'attendee', 'decision_maker', 'family', 'broker')),
  CONSTRAINT site_visit_participants_attendance_check
    CHECK (attendance_status IN ('expected', 'confirmed', 'attended', 'absent', 'cancelled')),
  CONSTRAINT site_visit_participants_identity_check CHECK (
    (participant_type='user' AND user_id IS NOT NULL AND contact_id IS NULL AND external_name IS NULL)
    OR (participant_type='contact' AND contact_id IS NOT NULL AND user_id IS NULL AND external_name IS NULL)
    OR (participant_type='external' AND external_name IS NOT NULL AND user_id IS NULL AND contact_id IS NULL)
  )
);
CREATE UNIQUE INDEX IF NOT EXISTS site_visit_participants_user_uidx
  ON site_visit_participants (visit_id, user_id) WHERE user_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS site_visit_participants_contact_uidx
  ON site_visit_participants (visit_id, contact_id) WHERE contact_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS inventory_units (
  unit_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id INTEGER NOT NULL REFERENCES companies(company_id) ON DELETE CASCADE,
  project_id INTEGER NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
  unit_code VARCHAR(100) NOT NULL,
  unit_name VARCHAR(200),
  tower VARCHAR(100),
  floor VARCHAR(50),
  configuration VARCHAR(100),
  area_sqft NUMERIC(12,2),
  status VARCHAR(30) NOT NULL DEFAULT 'available',
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT inventory_units_code_not_blank CHECK (BTRIM(unit_code)<>''),
  CONSTRAINT inventory_units_area_check CHECK (area_sqft IS NULL OR area_sqft>0),
  CONSTRAINT inventory_units_status_check
    CHECK (status IN ('available', 'held', 'reserved', 'booked', 'sold', 'blocked', 'unavailable')),
  CONSTRAINT inventory_units_metadata_check CHECK (jsonb_typeof(metadata)='object'),
  UNIQUE (project_id, unit_code)
);
CREATE INDEX IF NOT EXISTS inventory_units_project_status_idx
  ON inventory_units (project_id, status, unit_code);

CREATE TABLE IF NOT EXISTS site_visit_units_shown (
  visit_id UUID NOT NULL REFERENCES site_visits(visit_id) ON DELETE CASCADE,
  unit_id UUID NOT NULL REFERENCES inventory_units(unit_id) ON DELETE RESTRICT,
  display_order INTEGER NOT NULL,
  interest_level VARCHAR(20),
  notes TEXT,
  shown_at TIMESTAMPTZ,
  shown_by UUID REFERENCES users(user_id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (visit_id, unit_id),
  UNIQUE (visit_id, display_order),
  CONSTRAINT site_visit_units_order_check CHECK (display_order>0),
  CONSTRAINT site_visit_units_interest_check
    CHECK (interest_level IS NULL OR interest_level IN ('low', 'medium', 'high', 'selected'))
);

CREATE TABLE IF NOT EXISTS site_visit_availability_rules (
  rule_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id INTEGER NOT NULL REFERENCES companies(company_id) ON DELETE CASCADE,
  project_id INTEGER NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
  day_of_week INTEGER NOT NULL,
  starts_at TIME NOT NULL,
  ends_at TIME NOT NULL,
  slot_duration_minutes INTEGER NOT NULL DEFAULT 60,
  slot_interval_minutes INTEGER NOT NULL DEFAULT 30,
  capacity INTEGER NOT NULL DEFAULT 1,
  timezone VARCHAR(100) NOT NULL DEFAULT 'Asia/Kolkata',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT site_visit_availability_day_check CHECK (day_of_week BETWEEN 1 AND 7),
  CONSTRAINT site_visit_availability_time_check CHECK (ends_at>starts_at),
  CONSTRAINT site_visit_availability_duration_check
    CHECK (slot_duration_minutes BETWEEN 15 AND 480 AND slot_interval_minutes BETWEEN 5 AND 240),
  CONSTRAINT site_visit_availability_capacity_check CHECK (capacity>0),
  UNIQUE (project_id, day_of_week, starts_at, ends_at)
);
CREATE INDEX IF NOT EXISTS site_visit_availability_project_idx
  ON site_visit_availability_rules (project_id, day_of_week) WHERE is_active=TRUE;

COMMIT;
